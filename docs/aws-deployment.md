# AWS deployment

This repository contains a reproducible, migration-first AWS demo deployment.
The code is designed so infrastructure can be reviewed and tested without
creating resources. A deployment is only considered verified after the manual
GitHub Actions workflow completes and its public readiness request succeeds.

## Service map

| AWS service | Repository configuration | Purpose |
| --- | --- | --- |
| CloudFormation | `infra/bootstrap.yaml` | Creates the retained Terraform state bucket, immutable ECR repositories, GitHub OIDC provider when needed, and deployment role. |
| Amazon VPC | `infra/terraform/network.tf` | Places the public load balancer and Fargate tasks in two public subnets and PostgreSQL in two isolated subnets. Security groups expose only HTTP to the load balancer and PostgreSQL from application tasks. |
| Amazon ECS on Fargate | `infra/terraform/ecs.tf` | Runs the portal/API, outbox publisher, worker, and one-off migration containers. Deployment circuit breakers automatically roll back unhealthy service revisions. |
| Application Load Balancer | `infra/terraform/ecs.tf` | Routes browser traffic to the portal and checks `/api/health/ready`, which proves the portal proxy, API, and database are reachable. |
| Amazon RDS for PostgreSQL | `infra/terraform/database.tf` | Provides encrypted PostgreSQL 17 storage in isolated subnets, seven-day backups, forced TLS, and a Secrets Manager-managed master password. |
| Amazon SQS | `infra/terraform/queue.tf` | Provides the encrypted generation queue, five-delivery redrive limit, encrypted dead-letter queue, and dead-letter CloudWatch alarm. |
| IAM and GitHub OIDC | `infra/bootstrap.yaml` and `infra/terraform/iam.tf` | Gives GitHub short-lived deploy credentials and gives each task only its required queue/database-secret access. No static AWS key is stored in GitHub or a container. |
| CloudWatch Logs and alarms | `infra/terraform/ecs.tf` and `queue.tf` | Retains per-process logs for 14 days and detects unhealthy targets or dead-lettered work. |

The public-subnet Fargate layout avoids the fixed cost of a NAT gateway for this
demo. Tasks receive public IP addresses for outbound package/service access, but
their security groups do not allow direct inbound traffic. For production, move
tasks to private subnets, add controlled egress or VPC endpoints, terminate HTTPS
with ACM, enable authentication, and turn on RDS deletion protection.

## Validate without creating resources

Prerequisites are Terraform 1.10 or newer, the AWS CLI, and Docker. Run:

```bash
make infra-validate
aws cloudformation validate-template --template-body file://infra/bootstrap.yaml
docker build --file services/migrate/Dockerfile --tag blooms-migrate:test .
```

`make infra-validate` checks formatting, initializes the locked AWS provider
without a state backend, validates the full graph, and runs mocked native
Terraform assertions. Those assertions fail if PostgreSQL becomes public or
unencrypted, SQS encryption/redrive changes, services start before migrations, or
the load-balancer readiness path is weakened.

## One-time bootstrap

The bootstrap creates persistent resources and therefore requires explicit AWS
authorization. It is safe to reuse an account's existing GitHub OIDC provider:

```bash
oidc_provider_arn=$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" \
  --output text)

aws cloudformation deploy \
  --stack-name blooms-taxonomy-bootstrap \
  --template-file infra/bootstrap.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ExistingGitHubOidcProviderArn="$oidc_provider_arn"
```

If the query returns `None`, omit `ExistingGitHubOidcProviderArn` and the stack
will create the provider. The role trust policy accepts tokens only from the
`s-chall/mcq-generation-blooms-taxonomy` repository's `demo` environment.

After the stack completes, create the GitHub `demo` environment and set these
environment variables:

- `AWS_DEPLOY_ROLE_ARN`: the stack's `DeployRoleArn` output;
- `AWS_REGION`: the bootstrap region, normally `us-east-1`.

Use environment protection rules if the repository plan supports them. They add a
human approval boundary before GitHub can request the AWS role.

## Migration-first deployment

Run the `Deploy AWS demo` workflow manually from `main`. It performs one cohesive
release:

1. exchanges the GitHub OIDC token for short-lived AWS credentials;
2. builds four images and pushes immutable commit-SHA tags to ECR;
3. applies Terraform with all long-running services set to zero;
4. runs the same migration image as a one-off Fargate task and checks its exit
   code;
5. starts the requested portal, publisher, and worker task counts only after the
   migration succeeds;
6. waits for ECS stability and requests the public `/api/health/ready` endpoint.

This ordering prevents a new service revision from starting against an old
schema. ECS deployment circuit breakers roll back revisions whose tasks or load
balancer health checks fail. SQS and the database-level leases/deduplication handle
worker restarts and repeated delivery independently of ECS replacement.

## Cost and teardown boundary

An active deployment creates billable ALB, RDS, Fargate, public IPv4, CloudWatch,
SQS, ECR, S3, and data-transfer usage. Review the current AWS pricing for the
selected region before deployment. Setting both desired counts to zero stops
Fargate service tasks but does not remove the ALB or RDS charges.

Destroy the Terraform-managed runtime from the initialized `infra/terraform`
directory with `terraform destroy`. The bootstrap deliberately retains its state
bucket and image repositories, even if the CloudFormation stack is deleted, so
they must be emptied and removed separately when their recovery history is no
longer needed. Never delete the state bucket before destroying the Terraform
runtime.

## Evidence status

The current code supports these bounded statements:

- the AWS architecture is versioned, formatted, provider-validated, and protected
  by native infrastructure tests;
- CI builds the production containers and rejects insecure infrastructure
  regressions;
- the deployment pipeline uses GitHub OIDC, immutable image tags, migrations,
  ECS stability waits, and a live readiness gate.

Until a workflow run is linked and its AWS resources are inspected, do not claim
that the service is deployed to AWS or that recovery has been observed on AWS.
Local PostgreSQL/Moto failure-injection tests remain the evidence for retry,
duplicate-delivery, and interruption correctness.
