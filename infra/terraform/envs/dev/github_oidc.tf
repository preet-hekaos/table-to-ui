# GitHub Actions signs in to AWS with short-lived OIDC tokens: no long-lived access keys are stored anywhere.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"] # only merges to main may deploy
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "tableui-dev-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "DescribeCluster"
    actions   = ["eks:DescribeCluster", "eks:ListClusters"]
    resources = [module.eks.cluster_arn]
  }
  statement {
    sid       = "PushImages"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "PushToRepositories"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload",
      "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.api.arn, aws_ecr_repository.web.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

resource "aws_eks_access_entry" "github" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
}

resource "aws_eks_access_policy_association" "github" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
  access_scope {
    type       = "namespace"
    namespaces = ["tableui"]
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "tableui/api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "tableui/web"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}
