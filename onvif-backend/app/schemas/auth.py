from pydantic import BaseModel, Field

class SignupRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    role: str = Field(default="client", pattern="^(client|admin|supervisor)$")

class AdminApproveSignupRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    approve: bool = True

class SignupFinalizeRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    otp: str = Field(..., max_length=64)
    password: str = Field(..., min_length=8, max_length=1024)

from typing import Optional, List

class LoginRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    password: str = Field(..., min_length=8, max_length=1024)
    role: str = Field(default="client", pattern="^(client|admin|supervisor)$")
    captcha_id: Optional[str] = Field(None, max_length=255)
    captcha_text: Optional[str] = Field(None, max_length=64)
    mfa_code: Optional[str] = Field(None, max_length=64)

class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    captcha_id: Optional[str] = Field(None, max_length=255)
    captcha_text: Optional[str] = Field(None, max_length=64)

class SupervisorPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=1024)
    confirm_password: str = Field(..., min_length=8, max_length=1024)

class SupervisorVerifyRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=1024)

class ResetPasswordRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    otp: str = Field(..., max_length=64)
    new_password: str = Field(..., min_length=8, max_length=1024)
    confirm_password: str = Field(..., min_length=8, max_length=1024)

from typing import Optional, List

class AdminCreateUserRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    password: str = Field(..., min_length=8, max_length=1024)
    role: str = Field(default="client", pattern="^(client|admin|supervisor)$")
    allowedCameras: Optional[List[str]] = None
    is_blocked: Optional[bool] = None

class AdminUpdateUserRequest(BaseModel):
    role: Optional[str] = Field(None, pattern='^(client|admin|supervisor)$')
    password: Optional[str] = Field(None, min_length=8, max_length=1024)
    allowedCameras: Optional[List[str]] = None
    is_blocked: Optional[bool] = None

class ChangePasswordRequest(BaseModel):
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$', max_length=255)
    old_password: str = Field(..., min_length=8, max_length=1024)
    new_password: str = Field(..., min_length=8, max_length=1024)
    confirm_password: str = Field(..., min_length=8, max_length=1024)

class MFASetupResponse(BaseModel):
    secret: str
    uri: str

class MFAVerifyRequest(BaseModel):
    code: str = Field(..., max_length=64)
