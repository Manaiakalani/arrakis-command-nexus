from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ConfigFile(BaseModel):
    filename: str
    sections: dict[str, dict[str, str]] = Field(default_factory=dict)


class ConfigUpdate(BaseModel):
    filename: str
    section: str
    key: str
    value: str


class ConfigField(BaseModel):
    key: str
    value: str | None = None
    type: Literal["bool", "int", "float", "string"] = "string"
    description: str = ""
    default_value: str | None = None
    min_value: str | None = None
    max_value: str | None = None
    options: list[dict[str, str]] | None = None
