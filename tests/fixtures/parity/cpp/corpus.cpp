#include <vector>
#include "local.h"

#define MAX_RETRIES 3
#define SQUARE(x) ((x) * (x))

using namespace std;
using Handler = void (*)(int);

// A protocol handler keeps the retry budget.
class ProtocolHandler {
 public:
  int budget = MAX_RETRIES;
  bool handle(int code);

 private:
  void reset() { budget = MAX_RETRIES; }
};

struct RetryPolicy {
  int max_attempts;
};

typedef struct RetryPolicy retry_policy_t;

template<typename T>
class Box {
  T value;
};

template<typename T>
T box_value(Box<T> box) {
  return box.value;
}

namespace wire {
int encode(int value) {
  int attempts = 0;
  auto backoff = [&attempts](int base) {
    return base * SQUARE(attempts + 1);
  };
  return backoff(value);
}
}  // namespace wire

// Entry point wires the handler.
int main(int argc, char** argv) {
  ProtocolHandler handler;
  int status = wire::encode(argc);
  return status;
}
