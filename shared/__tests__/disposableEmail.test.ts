import { isDisposableEmail, emailDomain } from '../disposableEmail.js';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Real permanent providers must pass.
for (const email of [
  'user@gmail.com',
  'name.surname@googlemail.com',
  'me@outlook.com',
  'me@hotmail.com',
  'me@icloud.com',
  'me@yahoo.com',
  'me@proton.me',
  'me@protonmail.com',
  'me@pm.me',
  'student@university.edu',
  'a+tag@gmail.com',
]) {
  assert(!isDisposableEmail(email), `should allow permanent: ${email}`);
}

// Known temp-mail hosts must fail.
for (const email of [
  'x@mailinator.com',
  'x@guerrillamail.com',
  'x@sharklasers.com',
  'x@yopmail.com',
  'x@10minutemail.com',
  'x@temp-mail.org',
  'x@throwaway.email',
  'x@trashmail.com',
  'x@getnada.com',
  'x@maildrop.cc',
  'x@1secmail.com',
  'x@mail.tm',
  'x@tempmailo.com',
  'x@dispostable.com',
  'x@mohmal.com',
  // subdomain of listed host
  'x@abc.mailinator.com',
  'x@foo.guerrillamail.com',
]) {
  assert(isDisposableEmail(email), `should block disposable: ${email}`);
}

assert(emailDomain('A@Mailinator.COM') === 'mailinator.com', 'domain normalize');
assert(emailDomain('bad') === null, 'invalid email domain');

console.log('disposableEmail.test.ts: ok');
