# Towards AI-Assisted Multiple Choice Question Generation and Quality Evaluation at Scale

Research code and materials from a study on using GPT-3.5 to generate Bloom's-Taxonomy-aligned multiple choice questions (MCQs) for college-level chemistry and biology, and evaluating their quality both automatically and against a subject-matter expert.

## The problem

Writing good multiple choice questions by hand is slow, and reusing a small question bank leads to item repetition, which puts test security and reliability at risk, especially in high-stakes assessments. Prior work has used language models to generate questions, but none of it explicitly targeted Bloom's Taxonomy levels or validated whether a model actually produced the requested cognitive level.

## What this project does

This repo contains the analysis code and paper behind an AI pipeline that:

- Generates MCQs at each Bloom's Taxonomy level (Remember through Create) using zero-shot prompting with GPT-3.5-turbo, based on excerpts from OpenStax Chemistry 2e and Biology 2e.
- Automatically flags common item-writing flaws (IWFs) in each question, replicating an NLP-based detector across 19 flaw types drawn from 31 item-writing guidelines.
- Classifies each question's actual Bloom's level with a RoBERTa + CNN model, trained on 2,522 labeled questions (90/10 train/test split), to check whether the model followed the prompt.
- Compares machine judgments against a domain expert with 28+ years of STEM teaching experience, who rated a random sample of 57 of the 120 generated questions.

## Results

- The Bloom's-level classifier reached 83.79% accuracy and an 83.69% weighted F1 score on held-out questions.
- GPT-3.5 was most reliable at generating "Remember"-level questions and least reliable at higher-order levels such as "Analyze" and "Synthesis," where alignment with the intended taxonomy level dropped.
- Human and automated quality judgments diverged: the domain expert rated 21% of questions as high quality, while the automated IWF-based check rated 42% as high quality, pointing to a real gap between rule-based and expert evaluation.

## Repository contents

- `notebooks/AE_Analysis.ipynb` - exploratory analysis of pipeline pass rates and Bloom's-level alignment, including Sankey diagrams and pass-rate charts.
- `notebooks/CHI_Square_Test.ipynb` - chi-square independence test relating question usability ratings to the number of item-writing flaws detected.
- `data/sample_generated_questions.csv` - a sample of the generated question set, including taxonomy labels and item-writing-flaw flags.
- `poster/poster.png` - the conference poster summarizing this work.

## Authors

Kevin Hwang, Sai Challagundla, Maryam Alomair, Fow-Sen Choe, Lujie Karen Chen - Glenelg High School and University of Maryland, Baltimore County.
