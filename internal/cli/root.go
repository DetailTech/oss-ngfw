// Package cli implements the ngfwctl command tree.
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	openngfwv1 "github.com/detailtech/oss-ngfw/api/gen/openngfw/v1"
	"github.com/detailtech/oss-ngfw/internal/version"
)

// NewRootCommand builds the ngfwctl command tree.
func NewRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "ngfwctl",
		Short:         "OpenNGFW command-line client",
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	root.AddCommand(newVersionCommand())
	return root
}

func newVersionCommand() *cobra.Command {
	var server string
	cmd := &cobra.Command{
		Use:   "version",
		Short: "Print client version; with --server, also the controld version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "ngfwctl "+version.String())
			if server == "" {
				return nil
			}
			resp, err := fetchServerVersion(cmd.Context(), server)
			if err != nil {
				return fmt.Errorf("query controld at %s: %w", server, err)
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "controld %s (commit %s, built %s)\n",
				resp.GetVersion(), resp.GetCommit(), resp.GetBuildDate())
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "controld gRPC address (e.g. 127.0.0.1:9443)")
	return cmd
}

func fetchServerVersion(ctx context.Context, addr string) (*openngfwv1.GetVersionResponse, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return openngfwv1.NewSystemServiceClient(conn).GetVersion(ctx, &openngfwv1.GetVersionRequest{})
}
