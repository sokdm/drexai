# Legacy payment reference compatibility

The reported E11000 reference_1 duplicate null comes from a legacy unique payments.reference index. The current checkout previously wrote only txRef, so the missing legacy field became another null index entry. New Payment documents now populate reference from the unique server-generated txRef, including explicit-null new documents. The existing txRef unique index remains enforced.

No indexes are dropped. Historical payment records, wallet balances and captured package amounts/credits are untouched. No provider payment is simulated or sent by the regression test; it creates only local pending payment documents in MongoMemoryReplSet with the reported legacy index.

Deployment: after the backend deploys, retry Buy Credits. A previous failed local insert did not create or credit a purchase. Existing Flutterwave verification and authenticated checkout are unchanged.

Follow-up: Render logs also confirm a legacy unique id_1 index. New Payment documents now explicitly persist id as their MongoDB _id string, with Mongoose virtual id disabled for this model to avoid confusing a virtual getter with a stored field. Both reference_1 and id_1 are covered in the same regression database, including pre-existing null values. Existing historical identifiers are unchanged.
