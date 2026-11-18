#!/usr/bin/env python3
# File header: the shebang and this run are one comment element.
# A second header line joins the same run.

"""Module docstring: documents the file."""

from __future__ import annotations
import os
import sys as system
from pkg import a, b
from . import sibling
import x.y.z

LIMIT = 10
square = lambda x: x * x


# a run of comments directly above a definition
# documents that definition
def plain():
    pass


def documented(a, b):
    """Function docstring."""
    # a comment inside a body
    return a + b  # trailing comment after code


async def fetch():
    '''Single-quoted docstring on an async function.'''
    await other()


def commented_first():
    # a comment before the docstring
    """Docstring that follows a comment."""
    return 1


def generator():
    yield 1


def outer():
    def inner():
        pass
    return inner


def not_a_docstring():
    x = 1
    """A string that is not the first statement."""
    return x


@decorator
def decorated():
    pass


@decorator(arg=1)
@second
async def stacked():
    pass


class Plain:
    pass


@dataclass
class Decorated:
    """Class docstring."""

    attr = 1

    def __init__(self, a):
        self.a = a

    def method(self):
        """Method docstring."""
        def helper():
            pass

    @staticmethod
    def static():
        pass

    @property
    def prop(self):
        return 1

    async def amethod(self):
        pass

    class Nested:
        def inner_method(self):
            pass

    def after_nested(self):
        pass

    class LastMember:
        pass


def test_plain():
    def helper():
        pass


async def test_async():
    pass


def testCamel():
    pass


def test():
    pass


def testing():
    pass


@pytest.mark.parametrize("a", [1])
def test_decorated(a):
    pass


class TestCase:
    def test_method(self):
        pass

    @staticmethod
    def test_static():
        pass

    def helper(self):
        pass


# a run split by a blank line

# is a second element

if __name__ == "__main__":
    main()


class Tail:
    # a comment above a method
    def documented(self):
        pass


# a nested class that ends its parent is still a class element: last, decorated, only, deep
class EndsWithClass:
    def method(self):
        pass

    @decorator
    class DecoratedLast:
        pass


def ends_with_local_class():
    x = 1

    class LocalLast:
        pass


@decorator
class DecoratedOuter:
    class OnlyMember:
        pass


class Deep:
    class Middle:
        class Innermost:
            pass
