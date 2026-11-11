FROM postgres:18-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends age awscli nodejs ca-certificates coreutils bash \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/keel
COPY scripts/backup-postgres-tenant-snapshot.sh /opt/keel/backup-postgres-tenant-snapshot.sh
RUN chmod 0755 /opt/keel/backup-postgres-tenant-snapshot.sh \
 && mkdir -p /var/lib/keel-backups \
 && chmod 0700 /var/lib/keel-backups
ENV KEEL_BACKUP_DIR=/var/lib/keel-backups
CMD ["bash", "/opt/keel/backup-postgres-tenant-snapshot.sh"]
