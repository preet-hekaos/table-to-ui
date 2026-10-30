from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from tableui.identity.api.deps import DbDep, PendingPrincipalDep, PrincipalDep, SettingsDep
from tableui.identity.application import auth, invitations
from tableui.identity.application.sessions import preview_as, revoke
from tableui.identity.domain.ports import OrganisationProvider
from tableui.platform.mail import Mailer
from tableui.platform.web import bearer, get_mailer, get_request_id, state_get

router = APIRouter(prefix="/v1", tags=["identity"])


class SignUpRequest(BaseModel):
    agency_name: str = Field(max_length=200)
    full_name: str = Field(max_length=200)
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


class SignUpResponse(BaseModel):
    tenant_id: str
    token: str
    mfa_enrolment_required: bool = True


class SignInRequest(BaseModel):
    email: str
    password: str


class SignInResponse(BaseModel):
    token: str
    mfa_required: bool
    mfa_enrolled: bool


class CodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class MfaEnrolment(BaseModel):
    secret: str
    otpauth_uri: str


class MeResponse(BaseModel):
    user_id: str
    email: str
    full_name: str
    tenant_id: str | None
    tenant_name: str | None
    role: str | None
    permissions: list[str]
    mfa_enabled: bool
    mfa_verified: bool


class InviteRequest(BaseModel):
    email: str
    role: str


class InvitationState(BaseModel):
    state: str
    email: str | None = None
    tenant_name: str | None = None
    role: str | None = None


class AcceptRequest(BaseModel):
    full_name: str
    password: str


MailerDep = Annotated[Mailer, Depends(get_mailer)]


@router.post("/auth/signup", status_code=201, response_model=SignUpResponse)
async def signup(body: SignUpRequest, request: Request, db: DbDep) -> SignUpResponse:
    org: OrganisationProvider = state_get(request, "org")
    tenant_id, _user, token = await auth.sign_up(
        db,
        agency_name=body.agency_name,
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        provision=state_get(request, "provisioner"),
        org=org,
        request_id=get_request_id(request),
    )
    return SignUpResponse(tenant_id=str(tenant_id), token=token)


@router.post("/auth/sign-in", response_model=SignInResponse)
async def sign_in(
    body: SignInRequest, request: Request, db: DbDep, settings: SettingsDep
) -> SignInResponse:
    r = await auth.sign_in(
        db,
        email=body.email,
        password=body.password,
        realm="tenant",
        settings=settings,
        request_id=get_request_id(request),
    )
    return SignInResponse(token=r.token, mfa_required=r.mfa_required, mfa_enrolled=r.mfa_enrolled)


@router.post("/auth/mfa/verify", status_code=204)
async def mfa_verify(
    body: CodeRequest, request: Request, db: DbDep, settings: SettingsDep
) -> Response:
    await auth.verify_mfa(
        db,
        token=bearer(request) or "",
        code=body.code,
        realm="tenant",
        settings=settings,
        request_id=get_request_id(request),
    )
    return Response(status_code=204)


@router.post("/auth/mfa/enroll", response_model=MfaEnrolment)
async def mfa_enroll(p: PendingPrincipalDep, db: DbDep) -> dict[str, str]:
    async with db.control() as s:
        return await auth.start_mfa_enrolment(s, user_id=p.user_id, email=p.email)


@router.post("/auth/mfa/confirm", status_code=204)
async def mfa_confirm(body: CodeRequest, p: PendingPrincipalDep, db: DbDep) -> Response:
    async with db.control() as s:
        await auth.confirm_mfa_enrolment(
            s, user_id=p.user_id, session_hash=p.session_hash, code=body.code
        )
    return Response(status_code=204)


@router.post("/auth/sign-out", status_code=204)
async def sign_out(p: PendingPrincipalDep, db: DbDep) -> Response:
    async with db.control() as s:
        await revoke(s, p.session_hash)
    return Response(status_code=204)


@router.get("/me", response_model=MeResponse)
async def me(request: Request, p: PendingPrincipalDep, db: DbDep) -> dict[str, Any]:
    role = request.headers.get("x-preview-role")
    env = request.headers.get("x-preview-env")
    if (role or env) and p.tenant_id:
        # Studio's "See it as": the screens must draw what that role could do, not what the builder can.
        async with db.control() as s:
            p = await preview_as(s, p, role or (p.role_key or ""), env or "live")
    return {
        "user_id": str(p.user_id),
        "email": p.email,
        "full_name": p.full_name,
        "tenant_id": str(p.tenant_id) if p.tenant_id else None,
        "tenant_name": p.tenant_name,
        "role": p.role_key,
        "permissions": sorted(g for g in p.permissions if p.allows(g)),
        "mfa_enabled": p.mfa_enabled,
        "mfa_verified": p.mfa_verified,
    }


@router.post("/invitations", status_code=201)
async def invite(
    body: InviteRequest,
    request: Request,
    p: PrincipalDep,
    db: DbDep,
    settings: SettingsDep,
    mailer: MailerDep,
) -> dict[str, str]:
    async with db.control() as s:
        inv, link = await invitations.send_invitation(
            s,
            principal=p,
            email=body.email,
            role_key=body.role,
            settings=settings,
            mailer=mailer,
            request_id=get_request_id(request),
        )
    out = {"id": str(inv)}
    if settings.environment == "local":
        out["dev_accept_link"] = link  # local development only; other environments email it
    return out


@router.get("/invitations/{token}", response_model=InvitationState)
async def invitation_state(token: str, db: DbDep) -> dict[str, Any]:
    async with db.control() as s:
        info = await invitations.describe_invitation(s, token)
    return {
        "state": info.state,
        "email": info.email,
        "tenant_name": info.tenant_name,
        "role": info.role_key,
    }


@router.post("/invitations/{token}/accept", status_code=201, response_model=SignUpResponse)
async def invitation_accept(
    token: str, body: AcceptRequest, request: Request, db: DbDep
) -> SignUpResponse:
    async with db.control() as s:
        session_token, tenant_id = await invitations.accept_invitation(
            s,
            token=token,
            full_name=body.full_name,
            password=body.password,
            request_id=get_request_id(request),
        )
    return SignUpResponse(tenant_id=str(tenant_id), token=session_token)
