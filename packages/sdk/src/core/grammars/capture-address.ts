/** The pattern of a capture's name: `h1.section` is the section of an `h1`. */
export const CAPTURE_NAME = "[A-Za-z_][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*";

/** A capture's address, `{grammar}:{capture}`. */
export const CAPTURE_ADDRESS = /^([a-z][a-z0-9_-]*):([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)$/;
