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
dependency-audit, and build gates. Publishing a release runs the AWS deploy
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
6. Create the GitHub deploy role with
   [`github-deploy-role.yaml`](github-deploy-role.yaml). It trusts only the
   `production` environment of `vvojtisek/workout-logger` through GitHub OIDC,
   using GitHub's immutable owner and repository IDs in the subject claim, and
   may only send `AWS-RunShellScript` to `i-08abc66a2687aed45` and read the
   result; it has no EC2 or security-group permissions. From a workstation
   with admin credentials for the account:

   ```bash
   aws cloudformation deploy --region eu-central-1 \
     --stack-name workout-logger-github-deploy \
     --template-file deploy/aws/github-deploy-role.yaml \
     --capabilities CAPABILITY_IAM
   aws cloudformation describe-stacks --region eu-central-1 \
     --stack-name workout-logger-github-deploy \
     --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
   ```

   If the account already has the `token.actions.githubusercontent.com` OIDC
   provider, add `--parameter-overrides CreateGitHubOidcProvider=false`.
7. Set the printed ARN as the `AWS_DEPLOY_ROLE_ARN` repository variable
   (`gh variable set AWS_DEPLOY_ROLE_ARN --body <arn>`), and optionally add a
   required reviewer to the `production` environment. Until this variable is
   set, the deploy workflow is skipped.
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

## Automatic release and deployment

Every merge to `main` releases itself once **Merge checks** (the production
Compose end-to-end run) passes for that commit. The **Continuous delivery**
workflow then:

1. reads the Conventional Commits since the newest `vX.Y.Z` tag
   (`scripts/release_version.py`). `feat` bumps the minor version; `fix`,
   `perf` and `revert` bump the patch; `type!:` or a `BREAKING CHANGE:` footer
   bumps the major. Nothing else (`chore`, `docs`, `test`, `ci`, `refactor`,
   or a subject that is not a Conventional Commit) cuts a release, and the run
   ends green with the reason in its summary. Commits by
   `github-actions[bot]` and `chore(release):` commits are always ignored.
2. calls **Tagged release** for that version and commit: it re-runs the
   quality gates, checks again that Merge checks passed for the commit, builds
   the ARM64/AMD64 image as `ghcr.io/vvojtisek/workout-logger:vX.Y.Z`, creates
   the tag and the GitHub Release with a grouped changelog, then moves
   `:latest` to it.
3. calls **Deploy release to AWS EC2 through SSM**, which waits up to five
   minutes for `https://fitness.vvojtisek.eu/health/ready` to report the new
   version and fails the run if it does not.

Release decisions, releases and deployments each run one at a time. No commit
is written back to `main`; the version shown in the UI comes from the tag at
build time. To pause automatic releases, set the repository variable
`AUTO_RELEASE` to `false` (`gh variable set AUTO_RELEASE --body false`); delete
it to resume. To release the current `main` by hand after a pause, run
**Continuous delivery** from the Actions tab.

Pushing a tag by hand still works and goes through the same gates:

```bash
git switch main
git pull --ff-only origin main
git tag -a v1.1.0 -m "Workout Logger v1.1.0"
git push origin v1.1.0
```

To roll back, or to redeploy a release after fixing something on the host,
deploy any earlier release tag:

```bash
gh workflow run deploy-aws.yml --ref main -f release_tag=v2.0.2
```

The deploy script backs up the database before migration-bearing upgrades and
restores the previous image if the new one fails its readiness check. Rolling
back keeps the newer database schema, which is why migrations must stay
backward-compatible with the previous release. From v2.1.0 on, an image that
starts on a schema newer than it knows skips `alembic upgrade` instead of
crash-looping (`app/schema_guard.py`). Releases up to v2.0.2 lack that guard:
to go back to one of them after a newer release migrated the database, restore
the pre-upgrade backup from `/srv/workout-logger/backups` first.

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
