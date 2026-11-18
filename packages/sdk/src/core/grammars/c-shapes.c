// File header: the first comment run documents the file, not the include below.
// A second header line joins the same run.

#include <stdio.h>
#include "local.h"
#include <stdlib.h>

#define MACRO 1
#ifdef FEATURE
#endif

/** A doc comment directly above a definition documents it. */
int add(int a, int b) {
  /* a block comment inside a body */
  return a + b; // trailing comment after code
}
static int helper(void);
int *ptr_proto(void);
char *make(int n) { return 0; }
int (*fnptr)(int);
void noargs() {}
int variadic(const char *fmt, ...);
static inline int tiny(void) { return 0; }
extern int extern_proto(void);
int old_style(a, b) int a; int b; { return a; }

/// triple-slash doc run
/// over two lines
struct Point {
  int x;
  int y;
};
struct Forward;
struct { int a; } anon_var;
typedef struct { int a; } Anon;
typedef struct Node { int v; } Node;
typedef int myint;
typedef int (*callback)(int);
typedef char *string_t;
union Bits {
  int i;
  float f;
};
enum Color { RED, GREEN };
enum { ANON_A };

int global = 1;
int uninit;
const char *msg = "x";
static int counter, other = 2;
int first = 1, second = 2;
extern int ext;
int table[3] = {1, 2, 3};
int zeros[4];

/* a run split by a blank row */

/* is a second element */
int last(void) { return 1; }
