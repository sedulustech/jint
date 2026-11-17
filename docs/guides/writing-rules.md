---
title: "Writing rules"
description: "How to think about a rule: a goal holds several dimensions, the question defines its own word, the model sees only the element, and a good rule names a defect you can point at."
sidebar:
  label: "Writing rules"
---

# Writing jint rules

Writing rules is not easy. Most rules fail when rule authors choose the wrong properties to
look for.
A given comment, for example, has many properties we need to analyze to classify
it as a bad one: statefulness, drift, narration, among other things.
This means that a single rule to catch errors is not sufficient.

## Start from the goal, but don't make it a rule

Achieving a goal like catching unnecessary unit tests is rarely done with a single rule.
"Is this test unnecessary?" means several properties: a test that
cannot fail, a test that should be e2e, a test that repeats another case or testing upstream
functionalities. Write one rule per property.

![One goal, four rules](../figures/goal.svg)

## Define the words you are using

Defining the elements of a classification within the criteria goes a long way.
If you hand a classification model a goal where the explicit properties of what you're asking are
not set, it will make the classification rely on the model's weights instead of what you're
looking for.

Put yourself
in the classifying model's perspective. Think _"what would I need to know to classify this myself"_?

"Is this naming inconsistent with the codebase conventions?" fails because "inconsistent" means a different thing to every reader,
and the model picks its own criteria.

![Function names judged under an undefined and a defined question](../figures/define.svg)

## What the values mean

The values the classification model returns is a probability for each answer to be true, plus the model's confidence on the answer
it is providing. 0.5 means the model could not decide based on the evidence we provided it.
Either the evidence is not enough or the questions are not clear, as we stated previously.
Having ambiguous rules generally means that you're not separating the features enough. You should split the rule in two or improve
the evidence being presented to the classifier.

![Calibrated values with the warn and error thresholds](../figures/value.svg)

## Messages

Classifying is only useful if your agent can act on it. This is why it's recommended to return a
message to your agent with instructions on how to proceed when a certain threshold is met.

Messages should be one sentence, with one action: "Remove this comment." Otherwise, the agent will
not know what to do with the classification result.

![A rule has two readers: the model reads the question and criteria, the agent reads the message](../figures/messages.svg)
