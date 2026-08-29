# syntax=docker/dockerfile:1
# The scheduler for a self-host (#440): busybox crond calling the app's own
# cron routes with CRON_SECRET, replacing Vercel Cron one-for-one.

FROM alpine:3.20

RUN apk add --no-cache curl tzdata

COPY crontab /etc/crontabs/root
COPY run-job.sh /usr/local/bin/run-job.sh
RUN chmod +x /usr/local/bin/run-job.sh

# Schedules are UTC, matching vercel.json.
ENV TZ=UTC

# -f foreground, -d 8 log everything to stderr so `docker compose logs` shows
# each tick rather than swallowing it into a container-local mail spool.
CMD ["crond", "-f", "-d", "8"]
