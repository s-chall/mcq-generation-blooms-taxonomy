from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from generation_worker.__main__ import database_connection_info


class WorkerConfigurationTests(unittest.TestCase):
    def test_database_url_takes_precedence(self) -> None:
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://example/blooms"}, clear=True):
            self.assertEqual(database_connection_info(), "postgresql://example/blooms")

    def test_secret_backed_postgres_fields_form_connection_info(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PGHOST": "database.internal",
                "PGPORT": "5432",
                "PGDATABASE": "blooms",
                "PGUSER": "blooms_app",
                "PGPASSWORD": "generated secret",
                "PGSSLMODE": "require",
            },
            clear=True,
        ):
            connection_info = database_connection_info()
        self.assertIn("host=database.internal", connection_info)
        self.assertIn("password='generated secret'", connection_info)
        self.assertIn("sslmode=require", connection_info)


if __name__ == "__main__":
    unittest.main()
