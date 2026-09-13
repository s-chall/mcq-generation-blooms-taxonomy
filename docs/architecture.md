# Architecture

## Implemented in this repository

The current public foundation has six layers:

1. Versioned CSV fixtures governed by an explicit data contract.
2. A dependency-free Python validation and summary module used by the command
   line, notebooks, tests, and continuous integration.
3. A versioned PostgreSQL schema for generation jobs, question outputs,
   evaluations, human review, the transactional outbox, and consumer deduplication.
4. A TypeScript/Fastify API that registers source metadata, creates generation
   jobs, and reports job progress.
5. A Python publisher and SQS-compatible worker that deliver per-item outbox
   events, lease work, persist outputs, and recover from duplicate delivery or
   interrupted processes.
6. A React/TypeScript portal that registers source metadata, submits Bloom-targeted
   batches, monitors progress, records researcher decisions, and exports approved
   questions.

Keeping validation outside the notebooks gives every entry point the same rules
for answer uniqueness, Bloom labels, shot counts, and evaluation flags. Database
constraints independently enforce the business rules that must survive retries or
non-API writes. The API creates each job, all requested work items, and one outbox
event per item in one transaction. A request fingerprint makes idempotent retries
safe while rejecting accidental key reuse with a different payload. The publisher
and worker use expiring database leases; the worker records the logical outbox event
ID in the same transaction as the generated question so a redelivery cannot create
a second result. The portal hashes selected files locally and sends only metadata;
Nginx serves its static bundle and proxies `/api` to the TypeScript service. See
`docs/api.md`, `docs/database.md`, `docs/worker.md`, and
`docs/researcher-portal.md` for the contracts and failure behavior.

## Application boundary

The production extension will keep research inference in Python while separating
interactive requests from long-running generation work:

```text
React researcher portal             (implemented and interaction tested)
        |
Node.js/TypeScript API               (implemented)
        |
PostgreSQL/outbox                    (implemented)
        |
SQS-compatible queue -- Python worker (implemented and integration tested)
              |
      production model adapter        (planned)
```

The deterministic provider validates orchestration and recovery without claiming
production-quality question generation. Authentication, direct source upload, a
production model adapter, and the automated evaluation pipeline remain target
components and will move to the implemented boundary only with code and tests.

## AWS runtime boundary

Terraform maps the same containers and delivery contract to an AWS demo runtime:

```text
Internet -> Application Load Balancer -> ECS Fargate task
                                      web :8080 -> API :3000
                                                        |
                                                        v
                                              private Amazon RDS
                                                        ^
                                                        |
API outbox -> publisher task -> Amazon SQS -> worker task
                                  | retries
                                  v
                              dead-letter queue -> CloudWatch alarm
```

The API and portal share one Fargate task so Nginx can proxy to the API over the
task loopback interface. Publisher and worker processes use separate Fargate
services and least-privilege task roles. RDS has no public route and accepts port
5432 only from the application and worker security groups. ECS injects the
RDS-managed username and password from Secrets Manager; neither Terraform state
nor GitHub stores the generated password.

The load balancer is the only inbound public boundary. Demo tasks run in public
subnets with public IP addresses to avoid a NAT gateway, but have no inbound
security-group rules except load-balancer traffic to the application task. This
is a deliberate cost tradeoff, not the recommended production topology. A
production environment should use private application subnets, VPC endpoints or
controlled NAT egress, HTTPS with a managed certificate, authentication, and RDS
deletion protection.

The repository now contains this runtime as tested infrastructure-as-code and a
manual, OIDC-authenticated deployment workflow. It does not claim a live AWS
deployment until the workflow has created the resources and passed the public
readiness check. See `docs/aws-deployment.md` for that evidence boundary.
