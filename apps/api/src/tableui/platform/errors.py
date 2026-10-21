"""Problem Details (RFC 9457) error model shared by every module."""

from typing import Any


class ProblemError(Exception):
    """An error that is rendered as application/problem+json."""

    status = 400
    type_slug = "about:blank"
    title = "Bad request"

    def __init__(
        self,
        detail: str | None = None,
        *,
        errors: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail or self.title)
        self.detail = detail or self.title
        self.errors = errors or []
        self.extra = extra or {}

    def to_body(self, request_id: str | None, instance: str | None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "type": f"https://tableui.dev/problems/{self.type_slug}"
            if self.type_slug != "about:blank"
            else "about:blank",
            "title": self.title,
            "status": self.status,
            "detail": self.detail,
        }
        if instance:
            body["instance"] = instance
        if request_id:
            body["request_id"] = request_id
        if self.errors:
            body["errors"] = self.errors
        body.update(self.extra)
        return body


class ValidationFailed(ProblemError):
    status = 422
    type_slug = "validation-failed"
    title = "Validation failed"


class NotFound(ProblemError):
    status = 404
    type_slug = "not-found"
    title = "Not found"


class Unauthenticated(ProblemError):
    status = 401
    type_slug = "unauthenticated"
    title = "Authentication required"


class PermissionDenied(ProblemError):
    status = 403
    type_slug = "permission-denied"
    title = "Permission denied"


class VersionConflict(ProblemError):
    status = 409
    type_slug = "version-conflict"
    title = "Version conflict"


class RuleBlocked(ProblemError):
    status = 409
    type_slug = "rule-blocked"
    title = "A business rule blocked this change"


class ApprovalRequired(ProblemError):
    status = 409
    type_slug = "approval-required"
    title = "This change needs approval"


class IdempotencyConflict(ProblemError):
    status = 422
    type_slug = "idempotency-key-reuse"
    title = "Idempotency key reused with a different request"


class LimitReached(ProblemError):
    status = 409
    type_slug = "limit-reached"
    title = "This workspace has reached a limit"


class WorkspaceSuspended(ProblemError):
    status = 403
    type_slug = "workspace-suspended"
    title = "This workspace is not available"


class TooManyAttempts(ProblemError):
    status = 429
    type_slug = "too-many-attempts"
    title = "Too many failed attempts"


class TenantContextMissing(RuntimeError):
    """Raised when tenant data is requested without a tenant context (fail closed)."""
