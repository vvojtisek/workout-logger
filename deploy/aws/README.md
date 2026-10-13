# AWS Compose deployment on the shared EC2 host

This overlay runs the ARM64 release image on `i-08abc66a2687aed45` in
`eu-central-1`, alongside chem-app. It does not publish an application port or
change a security group. The existing Caddy service remains the only public
listener on TCP 443; the Workout Logger container joins chem-app's
`chem-app_public-net` Docker network and is reached by Caddy by service name.

The app image, versioned Compose file, environment example, Caddy snippet,
checksum, and deploy script are attached to every `vX.Y.Z` GitHub Release.
GitHub source archives are also available from that Release page. Release tags
must point to a commit already on `main` and pass the Python, frontend,
dependency-audit, and build gates. Publishing a release triggers the AWS deploy
workflow only after the GitHub `production` environment permits it and the
`AWS_DEPLOY_ROLE_ARN` repository variable is configured.

## One-time host and GitHub setup

1. Confirm the instance is registered and online in Systems Manager. The
   workflow assumes a GitHub OIDC role; the EC2 role needs
   `AmazonSSMManagedInstanceCore`. No SSH rule or new inbound security-group
   rule is needed.
2. Confirm chem-app's public network exists:
   `docker network inspect chem-app_public-net`.
3. Add [`chem-app-Caddyfile.snippet`](chem-app-Caddyfile.snippet) as a second
   site in `/srv/chem-app/deploy/aws/Caddyfile`, then validate and reload the
   existing Caddy service from `/srv/chem-app`. Its Route 53 DNS-01 plugin
   already handles certificates for the hosted zone. This is a chem-app
   configuration change and should be committed in that repository before
   enabling the release deployment workflow.
4. Point the `fitness.vvojtisek.eu` DNS A record at this EC2 instance's public
   address and remove any stale AAAA record. Preserve the existing HTTPS-only
   security-group rule; this deployment exposes no host port.
5. Through SSM, create `/srv/workout-logger/.env.production` from
   [`.env.production.example`](.env.production.example), replace `API_KEY` with
   at least 32 random characters, and set mode `0600`. Create the parent
   directory first and edit the secret file interactively (for example with
   `sudoedit`) so the API key does not enter shell history. Do not put
   credentials in GitHub Actions variables or release assets.
6. Set the GitHub repository variable `AWS_DEPLOY_ROLE_ARN`. Configure the
   `production` environment with the desired reviewer gate. The role trust
   policy must trust `token.actions.githubusercontent.com`, the audience
   `sts.amazonaws.com`, and repository `vvojtisek/workout-logger`; restrict
   the subject to the repository's `production` environment.
7. Grant the role `ssm:SendCommand` only for
   `AWS-RunShellScript` and instance `i-08abc66a2687aed45`, plus
   `ssm:GetCommandInvocation` on `*` as required by that SSM API.
   Do not grant EC2 or security-group mutation permissions.
8. Protect the `v*` tag pattern with a GitHub ruleset that blocks tag updates
   and deletion. Release tags identify immutable image versions.

The SSM deployment refuses to proceed until the production env file, shared
Docker network, and Caddy hostname route are present. It downloads and verifies
the ARM64 image bundle, makes a verified online SQLite backup before
migration-bearing upgrades, waits for the container readiness check, and
restores the previous image tag if startup fails. Migrations must remain
backward-compatible with the previous release because rollback keeps the
expanded database schema. The backup lives under `/srv/workout-logger/backups`;
the release also installs a systemd timer that retains the 14 newest verified
online SQLite backups there. Copy verified backups off-instance as a separate
operations task and rehearse restore before relying on the service.

## Account data boundary

Invited accounts have private personal workout and health records. Shared
exercise templates are read-only; food entries and other personal records are
account-owned. The static bootstrap `API_KEY` remains a global administrator
credential and must stay only in the protected production environment file.
The initial ownership migration assigns existing personal records to the
earliest admin account when one exists. Deploy this change only after the
account-isolation and account-capacity PRs are merged and reviewed; back up the
database before migration.

## Manual release and deployment

After the setup steps above, publish a semantic version tag from a green main
commit, for example:

```bash
git switch main
git pull --ff-only origin main
git tag -a v1.1.0 -m "Workout Logger v1.1.0"
git push origin v1.1.0
```

The tagged-release workflow builds and publishes the ARM64 image, then creates
the downloadable GitHub Release and dispatches the SSM deployment workflow. A
maintainer can also select **Deploy release to AWS EC2 through SSM** in GitHub
Actions and enter an existing release tag.

After the first deployment, bootstrap the administrator in an interactive SSM
session so the password is entered at the script prompt rather than stored in
GitHub or command history:

```bash
aws ssm start-session --region eu-central-1 --target i-08abc66a2687aed45
cd /srv/workout-logger
docker compose --project-name workout-logger \
  --env-file .env.release --env-file .env.production \
  -f compose.yaml exec -it workout-logger \
  python scripts/create_first_admin.py --email admin@example.com
```

To inspect a deployment, use Systems Manager Run Command history or connect
with an authorized workstation session and run:

```bash
cd /srv/workout-logger
docker compose --project-name workout-logger \
  --env-file .env.release --env-file .env.production \
  -f compose.yaml ps
curl -fsS https://fitness.vvojtisek.eu/health/ready
```
