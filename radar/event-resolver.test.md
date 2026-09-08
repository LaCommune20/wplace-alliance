# Event resolver test matrix

The deterministic test suite covers:

1. regions inside the proximity threshold;
2. regions outside the threshold;
3. event creation from a changed observation;
4. update of a matching active event;
5. transition from active to quiet after inactivity;
6. transition to closed after longer inactivity;
7. no event action for an unchanged observation.

The resolver itself remains pure and D1-free so the lifecycle rules can be validated before the Worker integration.
