"""A-Auth: Zero-trust credential proxy for AI agents."""

__version__ = "0.1.0"

from aauth.sdk.client import AAuth, PermissionChain, AAuthError

__all__ = ["AAuth", "PermissionChain", "AAuthError"]
