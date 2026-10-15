"""Module docstring for the corpus."""
import os
from typing import List

# A leading comment on the config class.
class Config:
    """Class docstring."""

    def __init__(self, name: str):
        self.name = name

    def render(self) -> str:
        # inner comment
        return self.name

def top_level(count: int) -> str:
    """Function docstring."""
    result = count
    return str(result)

handler = lambda: None
