#!/usr/bin/env php
<?php
// File header: the first comment run documents the file.
# A hash comment joins the same run.

namespace App\Models;

use Foo\Bar;
use Foo\{A, B};
use function Foo\helper;
use const Foo\LIMIT;

require_once 'x.php';
include 'y.php';

/** A doc comment directly above a function documents it. */
function add($a, $b) {
    // a comment inside a body
    return $a + $b; // trailing comment after code
}
function &byref() {}
function typed(int $a, ?string $b = null): ?string { return $b; }
function gen() { yield 1; }
function outer() {
    function inner() {}
    $closure = function () {};
}

$closure = function ($x) use ($y) { return $x; };
$arrow = fn($x) => $x * 2;
$static = static function () {};
array_map(function ($x) { return $x; }, $arr);
array_map(fn($x) => $x, $arr);
$result = compute();
$x = $y = 1;
const TOP = 1;
const A1 = 1, B1 = 2;
define('D', 1);

interface Shape { public function area(); }
trait Loud { public function shout() {} }
enum Suit: string {
    case Hearts = 'h';
    public function label(): string { return 'x'; }
}
abstract class Base {
    abstract public function ab();
}
final class Impl extends Base implements Shape {
    use Loud;
    const X = 1;
    public $prop = 1;
    public function __construct(private int $v) {}
    public function area() {}
    public static function sm() {}
    abstract protected function p();
    private function priv(): void {}
    /** A doc comment above a method. */
    public function documented() {
        $local = 1;
        $c = fn() => 1;
    }
}
$anon = new class { public function am() {} };

echo "hi";
if ($x) { go(); }

// a run split by a blank row

// is a second element
function last() {} // trailing comment after a definition
