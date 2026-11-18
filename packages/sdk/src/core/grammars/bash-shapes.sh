#!/usr/bin/env bash
# File header: the shebang and this run are one comment element.
# A second header line joins the same run.

source ./lib.sh # trailing comment after an import
. ./other.sh
source "$DIR/third.sh"

VAR=1
export EXPORTED=2
readonly RO=3
declare -r DECL=4
declare -a ARR=(1 2)
export ONLY_NAME
COUNT+=1
A=1 B=2

# a comment directly above a definition documents it
greet() {
  # a comment inside a body
  local name="$1"
  echo "hello $name" # trailing comment after code
}
function shout {
  echo "$1"
}
function whisper() {
  echo "$1"
}
oneliner() { :; }
subshelled() (
  cd /tmp
)
iffy() if true; then echo x; fi
outer() {
  inner() { :; }
  inner
}
function ns::qualified { :; }

s0() { :; }
setup_cmd arg
s1() { :; }
ls | grep x
s2() { :; }
build && deploy || rollback
s3() { :; }
cat <<EOF
heredoc body
EOF
s4() { :; }
echo out > file.txt
s5() { :; }
! false
s6() { :; }
(cd /tmp && ls)
s7() { :; }
{ echo grouped; }
s8() { :; }
if [ -f x ]; then
  echo yes
fi
s9() { :; }
for f in *.sh; do
  echo "$f"
done
s10() { :; }
for ((i = 0; i < 3; i++)); do
  echo "$i"
done
s11() { :; }
while read -r line; do
  echo "$line"
done
s12() { :; }
case "$1" in
  a) echo a ;;
esac
s13() { :; }
[[ -n "$VAR" ]]
s14() { :; }
until false; do break; done
s15() { :; }
(( total++ ))
s16() { :; }
select opt in a b; do break; done
s17() { :; }
exit 0

# a run of two statements
first_call
second_call # trailing comment ends nothing

s_end() { :; }

# a run split by a blank line

# is a second element
final() { :; }
