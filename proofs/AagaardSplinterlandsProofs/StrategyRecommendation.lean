import ObsmetrologiaComputing.GameTheory.VerificationTournament

/-!
# Splinterlands strategy recommendations

This module carries the proof obligations for an exhaustive, scored
Splinterlands strategy recommendation.
-/

namespace Aagaard.Splinterlands

abbrev VerificationCertificate :=
  Obsmetrologia.GameTheory.VerificationTournament.Certificate

abbrev VerificationSettledVerdict :=
  Obsmetrologia.GameTheory.VerificationTournament.SettledVerdict

/-- A chosen strategy, its finite search carrier, and the evidence that the
chosen strategy dominates every legal strategy in that carrier. -/
structure Recommendation (Strategy : Type) where
  chosen : Strategy
  candidates : List Strategy
  score : Strategy → Nat
  legal : Strategy → Bool
  chosenEnumerated : chosen ∈ candidates
  chosenLegal : legal chosen = true
  complete : ∀ strategy, legal strategy = true → strategy ∈ candidates
  dominates : ∀ strategy, strategy ∈ candidates → score strategy ≤ score chosen

namespace Recommendation

variable {Strategy : Type}

/-- The verification-tournament certificate induced by a complete dominant
recommendation. -/
protected def certificate (recommendation : Recommendation Strategy) :
    VerificationCertificate where
  noProfitableDeviation :=
    ∀ strategy, recommendation.legal strategy = true →
      recommendation.score strategy ≤ recommendation.score recommendation.chosen
  dialecticaWitnessSurvives :=
    ∀ strategy, recommendation.legal strategy = true →
      strategy ∈ recommendation.candidates
  equilibriumMatchesSurvivor :=
    recommendation.chosen ∈ recommendation.candidates

/-- Completeness and dominance discharge the three proposition-level
verification-certificate obligations. -/
theorem certificate_properties (recommendation : Recommendation Strategy) :
    recommendation.certificate.noProfitableDeviation ∧
      recommendation.certificate.dialecticaWitnessSurvives ∧
        recommendation.certificate.equilibriumMatchesSurvivor := by
  constructor
  · intro strategy hLegal
    exact recommendation.dominates strategy
      (recommendation.complete strategy hLegal)
  · constructor
    · exact recommendation.complete
    · exact recommendation.chosenEnumerated

/-- A recommendation whose closure orbit returns to its seed yields the
Obsmetrologia verification-tournament settled verdict. -/
theorem settled_of_recommendation
    (recommendation : Recommendation Strategy)
    (closure : Obsmetrologia.Reading.Closure)
    (seed : Obsmetrologia.Reading)
    {period : Nat}
    (periodPositive : 1 ≤ period)
    (cycle : Obsmetrologia.Reading.iter closure.op period seed = seed) :
    VerificationSettledVerdict closure seed recommendation.certificate := by
  have properties := certificate_properties recommendation
  exact
    Obsmetrologia.GameTheory.VerificationTournament.settled_verdict_of_closure_certificate
      closure seed periodPositive cycle recommendation.certificate
      properties.1 properties.2.1 properties.2.2

end Recommendation
end Aagaard.Splinterlands
