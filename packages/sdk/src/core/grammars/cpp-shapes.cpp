// File header: the first comment run documents the file, not the include below.
// A second header line joins the same run.

#include <vector>
#include "widget.hpp"

namespace ns {
int in_ns() { return 0; }
}

namespace {
int anon_ns() { return 0; }
}

extern "C" {
int c_linked(void);
}

/** A doc comment directly above a class documents it. */
class Widget {
 public:
  Widget();
  Widget(int a) : a_(a) {}
  ~Widget();
  virtual ~Widget() {}
  void proto() const;
  void inline_def() {
    // a comment inside a method body
  }
  static int sm() { return 1; }
  virtual void pure() = 0;
  virtual void ov() override {}
  int operator+(int x) { return x; }
  Widget &operator=(const Widget &) = default;
  template <typename T> void tmember(T t) {}
  friend void fr();
  int data_;
  using Alias = int;
  class Inner {
    void deep() {}
  };
  struct S {};
  enum class E { A };
  int last_method() { return 0; }
};

void Widget::out_of_line() {}
Widget::Widget() {}
int Widget::count = 0;

template <typename T> class Box { T v; };
template <typename T> struct TS {};
template <typename T> T identity(T x) { return x; }
template <typename T> void tproto(T);
template <> class Box<int> {};
class Derived : public Widget {};
class Fwd;

struct Point { int x; };
union Bits { int i; };
enum Color { RED };
enum class Scoped { A };
typedef int myint;
typedef struct { int a; } Anon;
using alias = int;
using namespace std;

int helper(void);
static int sfn(int a) { return a; }
inline int ifn() { return 1; }
constexpr int cfn() { return 1; }
auto trailing() -> int { return 1; }
auto lam = [](int x) { return x; };
int main() {
  auto inner = [] {};
  return 0;
}

int g = 1;
constexpr int K = 3;
static const int SC = 4;
int *pg = nullptr;
int first = 1, second = 2;

/* a run split by a blank row */

/* is a second element */
int last(void) { return 1; } // trailing comment after code

class Tail {
  /** A doc comment above a method. */
  void documented() {}
};
