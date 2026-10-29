#!/bin/sh
# AWS CLI through the amazon/aws-cli Docker image (the box has no native CLI).
# Prefer env access keys when present; otherwise ~/.aws/credentials + AWS_PROFILE.
# Never pass an empty AWS_PROFILE — AWS CLI treats that as profile "".
#
# `-e VAR` (without =value) forwards the host environment into the container,
# so secrets are not placed on the docker argv.
docker_args="--rm -i --user $(id -u):$(id -g) -v $HOME/.aws:/aws:ro -v /tmp:/tmp"
docker_args="$docker_args -e AWS_SHARED_CREDENTIALS_FILE=/aws/credentials"
docker_args="$docker_args -e AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-2}"
[ -n "${AWS_PROFILE:-}" ] && docker_args="$docker_args -e AWS_PROFILE"
[ -n "${AWS_ACCESS_KEY_ID:-}" ] && docker_args="$docker_args -e AWS_ACCESS_KEY_ID"
[ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && docker_args="$docker_args -e AWS_SECRET_ACCESS_KEY"
[ -n "${AWS_SESSION_TOKEN:-}" ] && docker_args="$docker_args -e AWS_SESSION_TOKEN"
# shellcheck disable=SC2086
exec docker run $docker_args amazon/aws-cli "$@"
