"""Public interface of the workspace module."""

from tableui.workspace.api.router import router
from tableui.workspace.application.install import BLANK, install_pack, onboarding_state

__all__ = ["BLANK", "install_pack", "onboarding_state", "router"]
