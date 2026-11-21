from enum import StrEnum


class TopItemType(StrEnum):
    ARTISTS = "artists"
    TRACKS = "tracks"


class TimeRange(StrEnum):
    SHORT_TERM = "short_term"
    MEDIUM_TERM = "medium_term"
    LONG_TERM = "long_term"
