import { RegistrationLifecycle } from '../core/registration';

const lifecycle = new RegistrationLifecycle(4);
lifecycle.add(21, 1.25);
const events = lifecycle.events();
if (events.map(e => e.state).join(',') !== 'CREATED,REQUESTING,REGISTERED') throw new Error('Registration transition history is incorrect.');
const state = lifecycle.get(21);
if (state.state !== 'REGISTERED' || state.start_time_s !== 1.25 || state.completion_time_s !== 1.25) throw new Error('Registration state timestamps are incorrect.');
lifecycle.remove(21, 2);
if (lifecycle.active().length !== 0 || lifecycle.events().at(-1)?.state !== 'REMOVED') throw new Error('Node removal was not recorded.');
lifecycle.add(22, 3);
if (lifecycle.events().length !== 4) throw new Error('Registration history is not bounded.');
console.log('✓ Registration abstraction records deterministic transitions and bounded history');
