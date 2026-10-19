package corpus

import "fmt"

// Doc for Handler.
type Handler struct {
	Name string
}

func (h Handler) Render() string {
	// inner comment
	return fmt.Sprintf("%s", h.Name)
}

func TopLevel(count int) string {
	result := count
	return fmt.Sprint(result)
}
