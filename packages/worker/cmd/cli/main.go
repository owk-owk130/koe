package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: koe <audio-file>")
		os.Exit(1)
	}

	// TODO: initialize pipeline and run
	fmt.Printf("processing: %s\n", os.Args[1])
}
