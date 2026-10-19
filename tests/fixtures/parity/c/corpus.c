// A fixed-capacity ring of tasks.
#include <stdlib.h>
#include "ring.h"

enum Status { OK = 0, FAILED = 1 };

struct Ring {
    int head;
    int tail;
};

typedef struct Ring *RingHandle;

static int g_capacity = 16;

int ring_init(struct Ring *r, int cap);

/* Creates an empty ring. */
struct Ring *ring_create(int cap) {
    struct Ring *r = malloc(sizeof(struct Ring));
    return r;
}

int ring_size(const struct Ring *r) {
    return r->head;
}
