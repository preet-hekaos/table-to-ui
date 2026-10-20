# infra

`terraform/envs/dev` defines the dev environment in AWS ap-south-1: VPC, EKS, two RDS Postgres instances (primary and analytics), Valkey, S3, SQS with a dead-letter queue, ECR, and a GitHub OIDC deploy role limited to `main`.

## Owner steps (one time)
1. Create or choose the AWS account; set billing alerts.
2. Create the state bucket `tableui-tfstate-dev` and lock table `tableui-tflock` in ap-south-1.
3. `cd terraform/envs/dev && terraform init && terraform apply`.
4. Set the repository variable `AWS_DEPLOY_ROLE_ARN` to the `github_deploy_role_arn` output.

CI runs `terraform fmt -check` and `validate` only; it never applies.
