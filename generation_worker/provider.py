from generation_worker.models import GeneratedQuestion, WorkItem


class DeterministicDemoProvider:
    """Offline provider for local verification; not a production model adapter."""

    def generate(self, item: WorkItem) -> GeneratedQuestion:
        return GeneratedQuestion(
            stem=(
                f"[{item.target_bloom}] Which response best demonstrates the learning "
                f"objective for {item.source_title}?"
            ),
            correct_answer="The response that directly satisfies the stated objective",
            distractors=(
                "A response based only on an unrelated fact",
                "A response that contradicts the source material",
                "A response that does not address the objective",
            ),
            model_name="deterministic-demo-provider",
        )
