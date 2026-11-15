'use strict';
const crypto=require('node:crypto');
const MONEY=/^(0|[1-9][0-9]*)$/;
const BPS=10000n;
function integerString(v,name){if(typeof v!=='string'||!MONEY.test(v))throw new Error(name+'_must_be_non_negative_integer_string');return BigInt(v);}
function boundedInt(v,name,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error(name+'_out_of_range');return v;}
function digest(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function assessInfrastructureProject(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('project_input_required');
 const projectId=String(input.projectId||'').trim(),name=String(input.name||'').trim(),currency=String(input.currency||'').toUpperCase();
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,79}$/.test(projectId))throw new Error('project_id_invalid');
 if(name.length<3||name.length>160)throw new Error('project_name_invalid');
 if(!/^[A-Z]{3}$/.test(currency))throw new Error('iso_currency_required');
 const assetValue=integerString(input.assetValueMinor,'asset_value');
 const encumbered=integerString(input.encumberedValueMinor,'encumbered_value');
 const haircut=BigInt(boundedInt(input.haircutBps,'haircut_bps',0,10000));
 const contracted=integerString(input.annualContractedRevenueMinor,'annual_contracted_revenue');
 const collected=integerString(input.annualCollectedRevenueMinor,'annual_collected_revenue');
 const operating=integerString(input.annualOperatingCostsMinor,'annual_operating_costs');
 const debt=integerString(input.annualDebtServiceMinor,'annual_debt_service');
 const deployed=boundedInt(input.deployedCapacityUnits,'deployed_capacity_units',0,1000000000);
 const available=boundedInt(input.availableCapacityUnits,'available_capacity_units',0,1000000000);
 if(encumbered>assetValue)throw new Error('encumbered_value_exceeds_asset_value');
 if(available>deployed)throw new Error('available_capacity_exceeds_deployed_capacity');
 const eligibleGross=assetValue*(BPS-haircut)/BPS;
 const eligibleNet=eligibleGross>encumbered?eligibleGross-encumbered:0n;
 const operatingCash=collected>operating?collected-operating:0n;
 const dscrBps=debt===0n?null:operatingCash*BPS/debt;
 const utilisationBps=deployed===0?null:BigInt(deployed-available)*BPS/BigInt(deployed);
 const revenueRealisationBps=contracted===0n?null:(collected*BPS/contracted);
 const evidence=input.evidence&&typeof input.evidence==='object'&&!Array.isArray(input.evidence)?input.evidence:{};
 const required=['assetRegister','ownership','encumbranceSearch','customerContracts','billing','cashCollections','operatingCosts','debtSchedule','capacityTelemetry'];
 const evidenceStates={};for(const key of required){const v=evidence[key];evidenceStates[key]=['verified','observed','estimated','missing','stale','conflicted'].includes(v)?v:'missing';}
 const gaps=required.filter(k=>!['verified','observed'].includes(evidenceStates[k]));
 const holds=[];
 if(gaps.length)holds.push('EVIDENCE_INCOMPLETE_OR_NOT_VERIFIED');
 if(collected>contracted&&contracted!==0n)holds.push('COLLECTIONS_EXCEED_CONTRACTED_REVENUE_RECONCILE');
 if(debt>0n&&operatingCash<debt)holds.push('OPERATING_CASH_BELOW_DEBT_SERVICE');
 if(encumbered>0n)holds.push('EXISTING_ENCUMBRANCE_PRESENT');
 if(available===deployed&&deployed>0)holds.push('NO_REPORTED_CAPACITY_UTILISATION');
 const dscrLabel=dscrBps===null?'NOT_CALCULATED':dscrBps>=12000n?'ABOVE_1_20X':dscrBps>=10000n?'BETWEEN_1_00X_AND_1_20X':'BELOW_1_00X';
 const result={schema:'keel.infrastructure-finance-assessment.v1',projectId,name,currency,asset:{grossValueMinor:assetValue.toString(),encumberedValueMinor:encumbered.toString(),haircutBps:Number(haircut),eligibleValueBeforeEncumbranceMinor:eligibleGross.toString(),eligibleValueAfterEncumbranceMinor:eligibleNet.toString()},operations:{deployedCapacityUnits:deployed,availableCapacityUnits:available,utilisationBps:utilisationBps===null?null:utilisationBps.toString()},cashFlow:{annualContractedRevenueMinor:contracted.toString(),annualCollectedRevenueMinor:collected.toString(),annualOperatingCostsMinor:operating.toString(),annualOperatingCashFlowMinor:operatingCash.toString(),annualDebtServiceMinor:debt.toString(),debtServiceCoverageBps:dscrBps===null?null:dscrBps.toString(),debtServiceCoverageBand:dscrLabel,revenueRealisationBps:revenueRealisationBps===null?null:revenueRealisationBps.toString()},evidence:evidenceStates,evidenceGaps:gaps,holds,decision:'EVIDENCE_REVIEW_REQUIRED',creditDecision:false,financingRecommendation:false,assumptions:'All amounts are integer minor units in one ISO currency. Metrics are deterministic diagnostics, not a credit rating, valuation, legal conclusion or lending decision.',fingerprint:null};
 result.fingerprint=digest(result);return result;
}
function demoScenario(id){
 const base={projectId:'synthetic-gpu-factory-001',name:'Synthetic GPU infrastructure project',currency:'USD',assetValueMinor:'100000000000',encumberedValueMinor:'10000000000',haircutBps:2000,annualContractedRevenueMinor:'42000000000',annualCollectedRevenueMinor:'36000000000',annualOperatingCostsMinor:'14000000000',annualDebtServiceMinor:'18000000000',deployedCapacityUnits:1000,availableCapacityUnits:180,evidence:{assetRegister:'verified',ownership:'verified',encumbranceSearch:'stale',customerContracts:'verified',billing:'observed',cashCollections:'observed',operatingCosts:'verified',debtSchedule:'verified',capacityTelemetry:'observed'}};
 if(id==='IFA-002')return assessInfrastructureProject({...base,annualCollectedRevenueMinor:'12000000000',annualDebtServiceMinor:'18000000000',evidence:{...base.evidence,customerContracts:'conflicted',cashCollections:'stale'}});
 if(id==='IFA-003')return assessInfrastructureProject({...base,encumberedValueMinor:'100000000000',availableCapacityUnits:1000,evidence:{assetRegister:'missing',ownership:'missing',encumbranceSearch:'missing',customerContracts:'missing',billing:'missing',cashCollections:'missing',operatingCosts:'missing',debtSchedule:'missing',capacityTelemetry:'missing'}});
 if(id!=='IFA-001')throw new Error('unknown_infrastructure_finance_scenario');
 return assessInfrastructureProject(base);
}
module.exports={assessInfrastructureProject,demoScenario,digest};
