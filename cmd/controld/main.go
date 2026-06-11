// controld is the OpenNGFW control-plane daemon.
//
// M0 scope: serve the SystemService gRPC API and report version.
// The policy model, candidate/commit store, compiler, and renderers
// arrive in M1.
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"

	openngfwv1 "github.com/detailtech/oss-ngfw/api/gen/openngfw/v1"
	"github.com/detailtech/oss-ngfw/internal/apiserver"
	"github.com/detailtech/oss-ngfw/internal/version"
)

func main() {
	showVersion := flag.Bool("version", false, "print version and exit")
	listen := flag.String("listen", "127.0.0.1:9443", "gRPC listen address")
	flag.Parse()

	if *showVersion {
		fmt.Println("controld " + version.String())
		return
	}

	if err := run(*listen); err != nil {
		slog.Error("controld exited", "error", err)
		os.Exit(1)
	}
}

func run(listen string) error {
	lis, err := net.Listen("tcp", listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", listen, err)
	}

	srv := grpc.NewServer()
	openngfwv1.RegisterSystemServiceServer(srv, &apiserver.SystemService{})

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(lis) }()
	slog.Info("controld started", "version", version.Version, "listen", listen)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		slog.Info("shutting down", "signal", sig.String())
		srv.GracefulStop()
		return nil
	case err := <-errCh:
		return fmt.Errorf("grpc server: %w", err)
	}
}
