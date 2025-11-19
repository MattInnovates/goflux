package main

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"sync"

	"github.com/0xRepo-Source/goflux/pkg/chunk"
	"github.com/0xRepo-Source/goflux/pkg/config"
	"github.com/0xRepo-Source/goflux/pkg/transport"
	"github.com/schollz/progressbar/v3"
)

func main() {
	// Simple flags - config file only
	configFile := flag.String("config", "goflux.json", "path to configuration file")
	version := flag.Bool("version", false, "print version")
	flag.Parse()

	if *version {
		fmt.Println("goflux version: 0.4.2")
		return
	}

	args := flag.Args()
	if len(args) < 1 {
		printUsage()
		os.Exit(1)
	}

	// Load or create configuration
	cfg, err := config.LoadOrCreateConfig(*configFile)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Get token from config or environment
	authToken := cfg.Client.Token
	if authToken == "" {
		authToken = os.Getenv("GOFLUX_TOKEN")
	}

	client := transport.NewHTTPClient(cfg.Client.ServerURL)
	if authToken != "" {
		client.SetAuthToken(authToken)
	}

	chunker := chunk.New(cfg.Client.ChunkSize)

	command := args[0]
	switch command {
	case "put":
		if len(args) < 3 {
			fmt.Println("Usage: goflux put <local-file> <remote-path>")
			os.Exit(1)
		}
		if err := doPut(client, chunker, args[1], args[2]); err != nil {
			log.Fatalf("Upload failed: %v", err)
		}
	case "get":
		if len(args) < 3 {
			fmt.Println("Usage: goflux get <remote-path> <local-file>")
			os.Exit(1)
		}
		if err := doGet(client, args[1], args[2]); err != nil {
			log.Fatalf("Download failed: %v", err)
		}
	case "ls":
		path := "/"
		if len(args) > 1 {
			path = args[1]
		}
		if err := doList(client, path); err != nil {
			log.Fatalf("List failed: %v", err)
		}
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printUsage()
		os.Exit(1)
	}
}

func doPut(client *transport.HTTPClient, chunker *chunk.Chunker, localPath, remotePath string) error {
	// Open file for streaming
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Get file size
	stat, err := file.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}
	fileSize := stat.Size()

	// Calculate number of chunks
	numChunks := int(fileSize / int64(chunker.Size))
	if fileSize%int64(chunker.Size) != 0 {
		numChunks++
	}

	fmt.Printf("Uploading %s (%d bytes, %d chunks)...\n", localPath, fileSize, numChunks)

	// Query server for existing upload session
	status, err := client.QueryUploadStatus(remotePath)

	// Track which chunks to upload
	chunksToUpload := make(map[int]bool)
	var totalToUpload int

	if err != nil {
		fmt.Printf("⚠️  Could not query upload status: %v (starting fresh upload)\n", err)
		// Upload all chunks
		for i := 0; i < numChunks; i++ {
			chunksToUpload[i] = true
		}
		totalToUpload = numChunks
	} else if status.Exists && !status.Completed {
		alreadyUploaded := numChunks - len(status.MissingChunks)
		fmt.Printf("🔄 Resuming upload: %d/%d chunks already uploaded\n", alreadyUploaded, numChunks)

		// Only upload missing chunks
		for _, chunkID := range status.MissingChunks {
			chunksToUpload[chunkID] = true
		}
		totalToUpload = len(status.MissingChunks)
	} else {
		// Fresh upload - upload all chunks
		for i := 0; i < numChunks; i++ {
			chunksToUpload[i] = true
		}
		totalToUpload = numChunks
	}

	// Create progress bar
	bar := progressbar.NewOptions(totalToUpload,
		progressbar.OptionEnableColorCodes(true),
		progressbar.OptionShowBytes(true),
		progressbar.OptionSetWidth(40),
		progressbar.OptionSetDescription("[cyan]Uploading...[reset]"),
		progressbar.OptionSetTheme(progressbar.Theme{
			Saucer:        "[green]=[reset]",
			SaucerHead:    "[green]>[reset]",
			SaucerPadding: " ",
			BarStart:      "[",
			BarEnd:        "]",
		}),
	)

	// Concurrent upload with worker pool
	type chunkWork struct {
		chunkID int
		data    []byte
	}

	// Pre-read all chunks that need to be uploaded
	chunksToProcess := make([]chunkWork, 0, totalToUpload)
	buffer := make([]byte, chunker.Size)
	chunkID := 0

	for {
		n, err := file.Read(buffer)
		if err == io.EOF {
			break
		}
		if err != nil {
			bar.Close()
			return fmt.Errorf("failed to read chunk: %w", err)
		}

		// Store chunk if it needs uploading
		if chunksToUpload[chunkID] {
			chunkData := make([]byte, n)
			copy(chunkData, buffer[:n])
			chunksToProcess = append(chunksToProcess, chunkWork{
				chunkID: chunkID,
				data:    chunkData,
			})
		}
		chunkID++
	}

	// Set up concurrent upload workers
	const maxConcurrency = 10
	workChan := make(chan chunkWork, len(chunksToProcess))
	errChan := make(chan error, len(chunksToProcess))
	var wg sync.WaitGroup
	var progressMu sync.Mutex

	// Start worker goroutines
	for i := 0; i < maxConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for work := range workChan {
				// Calculate checksum for this chunk
				hash := sha256.Sum256(work.data)
				checksum := hex.EncodeToString(hash[:])

				// Upload chunk
				uploadData := transport.ChunkData{
					Path:     remotePath,
					ChunkID:  work.chunkID,
					Data:     work.data,
					Checksum: checksum,
					Total:    numChunks,
				}

				if err := client.UploadChunk(uploadData); err != nil {
					errChan <- fmt.Errorf("failed to upload chunk %d: %w", work.chunkID, err)
					return
				}

				// Update progress bar thread-safely
				progressMu.Lock()
				_ = bar.Add(1)
				progressMu.Unlock()
			}
		}()
	}

	// Send work to workers
	go func() {
		defer close(workChan)
		for _, work := range chunksToProcess {
			workChan <- work
		}
	}()

	// Wait for all uploads to complete
	wg.Wait()
	close(errChan)

	// Check for any upload errors
	var uploadErrors []error
	for err := range errChan {
		uploadErrors = append(uploadErrors, err)
	}

	if len(uploadErrors) > 0 {
		bar.Close()
		return fmt.Errorf("upload failed with %d errors: %v", len(uploadErrors), uploadErrors[0])
	}

	_ = bar.Finish()
	fmt.Printf("\n✓ Upload complete: %s → %s\n", localPath, remotePath)
	return nil
}

func doGet(client *transport.HTTPClient, remotePath, localPath string) error {
	fmt.Printf("Downloading %s...\n", remotePath)

	// Create indeterminate progress bar (we don't know size beforehand)
	bar := progressbar.NewOptions(-1,
		progressbar.OptionSetDescription("[cyan]Downloading...[reset]"),
		progressbar.OptionSetWidth(40),
		progressbar.OptionSpinnerType(14),
		progressbar.OptionShowCount(),
		progressbar.OptionShowIts(),
		progressbar.OptionEnableColorCodes(true),
	)
	_ = bar.RenderBlank()

	data, err := client.Download(remotePath)
	if err != nil {
		bar.Close()
		return err
	}

	_ = bar.Finish()
	fmt.Printf("\n")

	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("✓ Download complete: %s → %s (%d bytes)\n", remotePath, localPath, len(data))
	return nil
}

func doList(client *transport.HTTPClient, path string) error {
	files, err := client.List(path)
	if err != nil {
		return err
	}

	fmt.Printf("Files in %s:\n", path)
	for _, f := range files {
		fmt.Printf("  %s\n", f)
	}
	return nil
}

func printUsage() {
	fmt.Println("goflux - Fast, resumable file transfer")
	fmt.Println("\nUsage:")
	fmt.Println("  goflux [--config <file>] <command> [args...]")
	fmt.Println("\nCommands:")
	fmt.Println("  put <local-file> <remote-path>   Upload a file")
	fmt.Println("  get <remote-path> <local-file>   Download a file")
	fmt.Println("  ls [path]                        List files (default: /)")
	fmt.Println("\nFlags:")
	fmt.Println("  --config <file>   Configuration file (default: goflux.json)")
	fmt.Println("  --version         Print version")
	fmt.Println("\nConfiguration:")
	fmt.Println("  Edit goflux.json to set server URL, token, and chunk size")
	fmt.Println("  Use GOFLUX_TOKEN environment variable for authentication")
	fmt.Println("\nExamples:")
	fmt.Println("  goflux ls")
	fmt.Println("  goflux put file.txt /uploads/file.txt")
	fmt.Println("  goflux --config prod.json get /data/file.zip ./file.zip")
}
