import json
from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class NotebookExecutionTests(unittest.TestCase):
    def test_public_notebooks_execute_without_private_data(self) -> None:
        for notebook_path in sorted((REPOSITORY_ROOT / "notebooks").glob("*.ipynb")):
            with self.subTest(notebook=notebook_path.name):
                notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
                namespace: dict[str, object] = {}
                for cell in notebook["cells"]:
                    if cell["cell_type"] != "code":
                        continue
                    source = "".join(cell["source"])
                    exec(compile(source, str(notebook_path), "exec"), namespace)


if __name__ == "__main__":
    unittest.main()
