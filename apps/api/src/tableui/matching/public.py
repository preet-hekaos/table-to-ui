"""Public interface of the matching module."""

from tableui.matching.api.router import router
from tableui.matching.domain.score import Part, parts_from, rank, score_one

__all__ = ["Part", "parts_from", "rank", "router", "score_one"]
