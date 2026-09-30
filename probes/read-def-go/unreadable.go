// Readability-negative control: deliberately unreadable Go file.
package main

var x = map[string]int{"q": 1, "w": 2, "e": 3, "r": 4, "t": 5}

func f(a []map[string]int, b []int, c int, d []map[string]int) int {
	s := 0
	for i := 0; i < c; i++ {
		u := b[i]
		if u > c {
			for j := 0; j < u; j++ {
				v := d[j]
				if v["q"] > v["w"] {
					s += v["q"] * v["w"]
					if v["e"] > 10 {
						s += v["r"]
						if v["t"] == 5 {
							s -= v["t"]
						} else {
							s += v["t"] * 2
						}
					} else {
						s -= v["e"]
					}
				} else {
					s -= v["r"]
				}
			}
		} else {
			w := x
			z := w["q"] + w["w"]
			if z > 100 {
				s += z
			}
		}
	}
	return s
}

func g1(x1 map[string]int) int { return x1["q"] + x1["w"] }
func g2(x2 map[string]int) int { return x2["e"] + x2["r"] }
func h(p []map[string]int) int { return f(p, []int{1, 2, 3}, 4, p) }
