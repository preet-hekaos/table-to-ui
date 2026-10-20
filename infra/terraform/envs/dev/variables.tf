variable "region" {
  description = "AWS region. Fixed to Mumbai for data residency (NFR12)."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = var.region == "ap-south-1"
    error_message = "Dev resources must stay in ap-south-1 (Mumbai)."
  }
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy through OIDC."
  type        = string
  default     = "preet-hekaos/table-to-ui"
}
