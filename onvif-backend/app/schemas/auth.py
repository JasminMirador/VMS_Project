from pydantic import BaseModel

class SignupRequest(BaseModel):
    email:    str
    role:     str = "client"

class AdminApproveSignupRequest(BaseModel):
    email: str
    approve: bool = True

class SignupFinalizeRequest(BaseModel):
    email: str
    otp: str
    password: str

from typing import Optional, List

class LoginRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"
    captcha_id: Optional[str] = None
    captcha_text: Optional[str] = None
    mfa_code: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    email: str
    captcha_id: Optional[str] = None
    captcha_text: Optional[str] = None

class SupervisorPasswordRequest(BaseModel):
    password:         str
    confirm_password: str

class SupervisorVerifyRequest(BaseModel):
    password: str

class ResetPasswordRequest(BaseModel):
    email:            str
    otp:              str
    new_password:     str
    confirm_password: str

from typing import Optional, List

class AdminCreateUserRequest(BaseModel):
    email:    str
    password: str
    role:     str = "client"
    allowedCameras: Optional[List[str]] = None
    is_blocked: Optional[bool] = None

class AdminUpdateUserRequest(BaseModel):
    role:     Optional[str] = None
    password: Optional[str] = None
    allowedCameras: Optional[List[str]] = None
    is_blocked: Optional[bool] = None

class ChangePasswordRequest(BaseModel):
    email: str
    old_password: str
    new_password: str
    confirm_password: str

class MFASetupResponse(BaseModel):
    secret: str
    uri: str

class MFAVerifyRequest(BaseModel):
    code: str
