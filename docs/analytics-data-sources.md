# Analytics data sources

Production analytics and reach predictions come from configured API/platform
connectors. The dashboard never substitutes sample records when a request
fails; it shows an error state so fabricated values cannot be mistaken for
measured performance.

Demo fixtures, if needed locally, must be explicitly gated by build-time
development mode and a `?demo=1` flag; they must never enter a production bundle.
