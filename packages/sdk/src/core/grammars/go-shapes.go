// Copyright header: the first comment run documents the file.
// A second header line joins the same run.

//go:build linux

// Package shapes is the package doc, a run split from the header by a blank row.
package shapes

import "fmt"
import (
	"os"
	str "strings"
	_ "embed"
)
import . "math"

// Pi documents the constant below it.
const Pi = 3.14
const (
	A = 1
	B = 2
)
const x, y = 1, 2
var global = 1
var (
	v1 int
	v2 string
)
var a, b int
var fnvar = func() {}

/* A block comment above a type documents it. */
type Point struct{ X, Y int }
type Alias = int
type (
	First  struct{}
	Second interface{}
)
type Gen[T any] struct{}
type Handler func(int)
type Iface interface{ M() }

// Add sums two ints.
// The doc run is one comment element.
func Add(a, b int) int { return a + b }

func (p Point) Dist() float64 { return 0 }
func (p *Point) Scale(f int) {
	// a comment inside a method
	p.X *= f // trailing comment after code
}
func (Point) NoName() {}
func (g Gen[T]) M()      {}
func Generic[T any](x T) T { return x }
func external(x int) int
func init()                {}
func variadic(xs ...int)   {}
func multi() (int, error) { return 0, nil }
func main() {
	f := func() {}
	defer func() {}()
	go func() {}()
	_ = f
}

func TestAdd(t *testing.T) {}
func TestMain(m *testing.M) {}
func Testify(x int)         {}
func TestRun(t *testing.T) {
	t.Run("sub", func(t *testing.T) {})
}
func Test_snake(t *testing.T) {}
func Test9(t *testing.T)       {}
func Testlower(t *testing.T)   {}
func TestOther(tb testing.TB)  {}
func BenchmarkX(b *testing.B)  {}
func ExampleX()                {}

// a run split by a blank row

// is a second element
func last() {} // trailing comment after a definition
