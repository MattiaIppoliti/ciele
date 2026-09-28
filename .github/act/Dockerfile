# The image `act` runs this repo's workflows in, locally (see
# scripts/verify-ci-local.sh). act's medium runner image, plus what GitHub's own
# ubuntu-latest has and it lacks. Add a tool here when a workflow step needs one.
FROM catthehacker/ubuntu:act-latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends shellcheck \
 && rm -rf /var/lib/apt/lists/*
