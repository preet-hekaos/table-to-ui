# ADR-9: AWS Mumbai, Terraform, OIDC deploys

Status: accepted

## Context
Data residency (NFR12) and no long-lived credentials.

## Decision
EKS, two RDS Postgres instances, Valkey, S3 and SQS in ap-south-1 via Terraform; GitHub Actions deploys through OIDC limited to main.

## Consequences
Applying the stack needs the owner's AWS account; CI runs fmt and validate only.
