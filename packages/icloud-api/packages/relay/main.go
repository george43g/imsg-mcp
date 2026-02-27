// Package relay provides a WebSocket server that generates IDS validation-data
// on macOS and serves it to cross-platform @icloud-api/core clients.
//
// This is the Mac-side component from the research plan (Tier 2).
// It wraps the same NAC (Network Access Control) APIs that
// beeper/mac-registration-provider uses, exposed as a WebSocket endpoint.
//
// Usage:
//
//	go build -o relay && ./relay --port 8080
//
// The relay only runs on macOS (uses identityservicesd private APIs).
// For other platforms, connect to a remote relay via WebSocket.
//
// Reference: docs/RESEARCH_ALBERT_APNS_2026-02-27.md (NAC section)
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
)

var port = flag.Int("port", 8080, "WebSocket server port")

func main() {
	flag.Parse()

	if runtime.GOOS != "darwin" {
		fmt.Fprintln(os.Stderr, "WARNING: relay server requires macOS for NAC validation-data generation.")
		fmt.Fprintln(os.Stderr, "On non-macOS platforms, this server will start but cannot generate validation data.")
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","platform":"%s","arch":"%s"}`, runtime.GOOS, runtime.GOARCH)
	})

	http.HandleFunc("/generate", handleGenerate)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("icloud-api relay server starting on %s (platform: %s/%s)", addr, runtime.GOOS, runtime.GOARCH)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func handleGenerate(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "darwin" {
		http.Error(w, "NAC generation requires macOS", http.StatusServiceUnavailable)
		return
	}

	// Phase 2: This will call into the NAC APIs via cgo to generate
	// validation-data for IDS registration. The approach is:
	//
	// 1. Load identityservicesd offsets for the current macOS version
	// 2. Call NACInit -> InitializeValidation -> NACKeyEstablishment -> NACSign
	// 3. Return the signed validation-data blob
	//
	// For now, return a placeholder indicating the endpoint exists.
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"error":"not_implemented","message":"NAC generation will be implemented in Phase 2"}`)
}
