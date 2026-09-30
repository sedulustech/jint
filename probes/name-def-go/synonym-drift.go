// Vocabulary defect: same concept, two words.
package main

type User struct {
	ID string
}

type Account struct {
	ID string
}

func getUser(id string) User {
	return User{ID: id}
}

func saveAccount(a Account) Account {
	return a
}
