/*
 * ClassCard Auto Helper
 *
 * 실행 위치:
 *   로그인된 classcard.net의 세트 페이지
 *   예) https://www.classcard.net/set/12766795/963594
 *
 * 실행 방법:
 *   1. 브라우저 개발자 도구 > Sources > Snippets에서 새 스니펫을 만든다.
 *   2. 이 파일 전체를 붙여 넣고 실행한다.
 *   3. 오른쪽 아래에 나타나는 패널에서 [미리보기] 또는 [선택 항목 실행]을 누른다.
 *
 * 콘솔에서 직접 호출할 수도 있다.
 *   ClassCardAuto.preview()
 *   await ClassCardAuto.runAll({ dryRun: false, confirmed: true })
 *
 * 안전장치:
 *   - 기본값은 dryRun=true라서 서버에 아무것도 제출하지 않는다.
 *   - 실제 제출에는 dryRun:false와 confirmed:true가 모두 필요하다.
 *   - 패널에서 실행할 때도 마지막 브라우저 확인창을 거친다.
 *
 * 주의:
 *   자신의 계정과 자신에게 허용된 과제에서만 사용한다.
 */

(() => {
  'use strict';

  const VERSION = '1.4.0';
  const GLOBAL_NAME = 'ClassCardAuto';
  const PANEL_ID = 'classcard-auto-panel';
  const TEST_FRAME_ID = 'classcard-auto-test-frame';
  const ACTIVITY_IDS = Object.freeze({
    memorize: 1,
    recall: 2,
    spell: 3,
  });
  const ACTIVITY_LABELS = Object.freeze({
    memorize: '암기',
    recall: '리콜',
    spell: '스펠',
  });

  function assertClassCardPage() {
    if (!/(^|\.)classcard\.net$/i.test(location.hostname)) {
      throw new Error('classcard.net 페이지에서 실행해 주세요.');
    }
  }

  function asPositiveInteger(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function valueOfInput(name) {
    const inputs = [...document.querySelectorAll(`input[name="${name}"]`)];
    return inputs.map((input) => input.value).find(Boolean) || null;
  }

  function idsFromLocation() {
    const setMatch = location.pathname.match(/\/set\/(\d+)(?:\/(\d+))?/i);
    if (setMatch) {
      return {
        setId: asPositiveInteger(setMatch[1]),
        classId: asPositiveInteger(setMatch[2]),
      };
    }

    const testMatch = location.pathname.match(/\/ClassTest\/(\d+)\/(\d+)/i);
    if (testMatch) {
      return {
        classId: asPositiveInteger(testMatch[1]),
        setId: asPositiveInteger(testMatch[2]),
      };
    }

    return { setId: null, classId: null };
  }

  function textFrom(element, selectors) {
    for (const selector of selectors) {
      const node = element.querySelector(selector);
      const text = node?.textContent?.trim();
      if (text) return text;
    }
    return '';
  }

  function cardsFromPage() {
    if (Array.isArray(window.study_data) && window.study_data.length) {
      return window.study_data.map((card, index) => ({
        id: String(card.card_idx ?? card.cardId ?? ''),
        front: String(card.front_data ?? card.front ?? '').trim(),
        back: String(card.back_data ?? card.back ?? '').trim(),
        section: asPositiveInteger(card.section_num) ?? Math.floor(index / 10) + 1,
        order: asPositiveInteger(card.card_order) ?? index + 1,
      }));
    }

    return [...document.querySelectorAll('.flip-card.sentence[data-idx]')].map(
      (element, index) => ({
        id: String(element.dataset.idx ?? ''),
        front: textFrom(element, [
          '.front .card-content',
          '.front .text',
          '.front',
          '.card-front',
        ]),
        back: textFrom(element, [
          '.back .card-content',
          '.back .text',
          '.back',
          '.card-back',
        ]),
        section: Math.floor(index / 10) + 1,
        order: index + 1,
      }),
    );
  }

  function getContext(overrides = {}) {
    assertClassCardPage();
    const locationIds = idsFromLocation();
    const cards = cardsFromPage().sort((a, b) => a.order - b.order);
    const context = {
      setId:
        asPositiveInteger(overrides.setId) ??
        asPositiveInteger(window.set_idx) ??
        locationIds.setId,
      classId:
        asPositiveInteger(overrides.classId) ??
        asPositiveInteger(window.class_idx) ??
        locationIds.classId,
      userId:
        asPositiveInteger(overrides.userId) ??
        asPositiveInteger(valueOfInput('user_idx')) ??
        asPositiveInteger(window.login_info?.user_idx),
      setType:
        asPositiveInteger(overrides.setType) ??
        asPositiveInteger(window.set_type) ??
        asPositiveInteger(valueOfInput('set_type')),
      cards,
    };

    if (!context.setId) {
      throw new Error('세트 ID를 찾지 못했습니다. 클래스카드 세트 페이지에서 실행해 주세요.');
    }
    if (!context.classId) {
      throw new Error('클래스 ID를 찾지 못했습니다. 클래스 과제에서 연 세트 페이지인지 확인해 주세요.');
    }
    if (!context.userId) {
      throw new Error('로그인한 학생 ID를 찾지 못했습니다. 로그인 상태를 확인해 주세요.');
    }
    if (!context.cards.length || context.cards.some((card) => !card.id)) {
      throw new Error('카드 ID 목록을 읽지 못했습니다. 세트 페이지를 새로고침한 뒤 다시 실행해 주세요.');
    }

    return context;
  }

  function groupCardsBySection(cards) {
    const groups = new Map();
    for (const card of cards) {
      if (!groups.has(card.section)) groups.set(card.section, []);
      groups.get(card.section).push(card);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }

  function normalizeActivities(activities) {
    const requested = activities?.length
      ? activities
      : ['memorize', 'recall', 'spell'];
    const unique = [...new Set(requested)];
    const invalid = unique.filter((name) => !(name in ACTIVITY_IDS));
    if (invalid.length) {
      throw new Error(`알 수 없는 학습 종류: ${invalid.join(', ')}`);
    }
    return unique;
  }

  function makeLearningForm(context, activity, sectionNumber, cards) {
    const form = new FormData();
    form.append('set_idx_2', String(context.setId));
    form.append('card_idx[]', '0');
    cards.forEach((card) => form.append('card_idx[]', card.id));
    form.append('score[]', '0');
    cards.forEach(() => form.append('score[]', '1'));
    form.append('activity', String(ACTIVITY_IDS[activity]));
    form.append('last_section', String(sectionNumber));
    form.append('last_round', '1');
    form.append('view_cnt', String(cards.length));
    form.append('user_idx', String(context.userId));
    form.append('class_idx', String(context.classId));
    form.append('is_know_card', '1');
    form.append('is_w_pro', '0');
    return form;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      ...options,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(`${url} 요청 실패: HTTP ${response.status}`);
    }
    if (!data) {
      throw new Error(`${url} 응답이 JSON이 아닙니다. 로그인이 만료됐을 수 있습니다.`);
    }
    if (data.result && data.result !== 'ok') {
      throw new Error(data.msg || `${url} 요청이 거절되었습니다.`);
    }
    return data;
  }

  function makePreview(context, activities = ['memorize', 'recall', 'spell']) {
    const sections = groupCardsBySection(context.cards);
    return {
      version: VERSION,
      page: location.href,
      setId: context.setId,
      classId: context.classId,
      userId: context.userId,
      setType: context.setType,
      cardCount: context.cards.length,
      sections: sections.map(([section, cards]) => ({
        section,
        cardCount: cards.length,
        firstCardId: cards[0]?.id,
        lastCardId: cards.at(-1)?.id,
      })),
      activities: normalizeActivities(activities).map((name) => ({
        name,
        label: ACTIVITY_LABELS[name],
      })),
      testAnswerCount: context.cards.filter((card) => card.front).length,
    };
  }

  function requireSubmissionApproval(options) {
    if (options.dryRun !== false) return false;
    if (options.confirmed !== true) {
      throw new Error('실제 제출에는 { dryRun: false, confirmed: true }가 필요합니다.');
    }
    return true;
  }

  async function submitLearning(options = {}) {
    const context = getContext(options);
    const activities = normalizeActivities(options.activities);
    const sections = groupCardsBySection(context.cards);
    const preview = makePreview(context, activities);

    if (!requireSubmissionApproval(options)) {
      return { dryRun: true, type: 'learning', preview };
    }

    const submissions = [];
    for (const activity of activities) {
      for (const [sectionNumber, cards] of sections) {
        const data = await fetchJson('/ViewSetAsync/learnAll', {
          method: 'POST',
          body: makeLearningForm(context, activity, sectionNumber, cards),
        });
        submissions.push({
          activity,
          label: ACTIVITY_LABELS[activity],
          section: sectionNumber,
          cardCount: cards.length,
          result: data.result ?? 'ok',
        });
      }
    }

    return { dryRun: false, type: 'learning', submissions };
  }

  function canonicalText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(
        /\((?:명|동|형|부|전|접|대|감|관|구|약|복수|과거|과거분사)\)/g,
        '',
      )
      .replace(/[“”‘’'".,!?;:()\[\]{}…·]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function optionText(flip, input) {
    const labels = [...flip.querySelectorAll('label')].filter(
      (label) => label.htmlFor === input.id,
    );
    const exact = labels.find((label) => label.classList.contains('hidden'));
    const visible = labels.find((label) => !label.classList.contains('hidden'));
    return String(
      exact?.textContent ??
        visible?.querySelector('.cc-table')?.textContent ??
        visible?.textContent ??
        '',
    )
      .replace(/정답\s*$/u, '')
      .trim();
  }

  function answersForTest(testDocument, cards, suppliedAnswers) {
    const flips = [...testDocument.querySelectorAll('#testForm .flip-card')];
    if (!flips.length) {
      throw new Error('생성된 테스트 카드가 비어 있습니다.');
    }

    if (Array.isArray(suppliedAnswers)) {
      if (suppliedAnswers.length !== flips.length) {
        throw new Error(
          `제공된 정답은 ${suppliedAnswers.length}개이고 테스트 문항은 ${flips.length}개입니다.`,
        );
      }
      return suppliedAnswers.map((value, index) => ({
        value: String(value),
        expected: String(value),
        mode: 'supplied',
        question: index + 1,
      }));
    }

    const unused = new Set(cards.map((_, index) => index));
    return flips.map((flip, position) => {
      const promptRaw = flip.querySelector('.front-hidden')?.textContent?.trim() ?? '';
      const prompt = canonicalText(promptRaw);
      const match = [...unused]
        .map((index) => {
          if (canonicalText(cards[index].front) === prompt) {
            return { index, shownSide: 'front', expected: cards[index].back };
          }
          if (canonicalText(cards[index].back) === prompt) {
            return { index, shownSide: 'back', expected: cards[index].front };
          }
          return null;
        })
        .find(Boolean);

      if (!match) {
        throw new Error(
          `${position + 1}번 제시어와 대응하는 카드를 찾지 못했습니다: ${promptRaw}`,
        );
      }
      unused.delete(match.index);

      const choices = [
        ...flip.querySelectorAll('input[type="radio"], input[type="checkbox"]'),
      ];
      if (choices.length) {
        const expected = canonicalText(match.expected);
        const choice = choices.find(
          (input) => canonicalText(optionText(flip, input)) === expected,
        );
        if (!choice) {
          throw new Error(
            `${position + 1}번 정답 선택지를 찾지 못했습니다: ${match.expected}`,
          );
        }
        return {
          value: choice.value,
          expected: match.expected,
          mode: 'choice',
          question: position + 1,
          cardId: cards[match.index].id,
        };
      }

      return {
        value: match.expected,
        expected: match.expected,
        mode: 'text',
        question: position + 1,
        cardId: cards[match.index].id,
      };
    });
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isVisibleInFrame(frame, element) {
    if (!element || element.closest('.hidden')) return false;
    const style = frame.contentWindow.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function firstVisibleInFrame(frame, selectors) {
    const testDocument = frame.contentDocument;
    for (const selector of selectors) {
      const element = [...testDocument.querySelectorAll(selector)].find((candidate) =>
        isVisibleInFrame(frame, candidate),
      );
      if (element) return element;
    }
    return null;
  }

  async function createTestFrame(testUrl, timeoutMs) {
    document.getElementById(TEST_FRAME_ID)?.remove();
    const frame = document.createElement('iframe');
    frame.id = TEST_FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      right: '0',
      bottom: '0',
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    });

    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('테스트 페이지 로드 시간이 초과되었습니다.')),
        timeoutMs,
      );
      frame.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      frame.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('테스트 페이지를 iframe으로 불러오지 못했습니다.'));
        },
        { once: true },
      );
    });

    frame.src = testUrl;
    document.body.append(frame);
    await loaded;
    if (!frame.contentDocument?.querySelector('#testForm')) {
      throw new Error('iframe에서 테스트 폼을 찾지 못했습니다.');
    }
    return frame;
  }

  function disposeTestFrame(frame) {
    if (!frame) return;
    try {
      if ('is_submited' in frame.contentWindow) {
        frame.contentWindow.is_submited = 1;
      }
    } catch {
      // 같은 출처 프레임이 이미 이동되거나 닫힌 경우는 무시한다.
    }
    frame.remove();
  }

  async function generateTestQuestions(frame, timeoutMs) {
    const startedAt = Date.now();
    let lastAction = '테스트 페이지 로드';

    while (Date.now() - startedAt < timeoutMs) {
      const testDocument = frame.contentDocument;
      const questionCount = testDocument.querySelectorAll(
        '#testForm [name="test_question[]"]',
      ).length;
      if (questionCount) return testDocument;

      const passwordModal = firstVisibleInFrame(frame, ['#quizPwdModal']);
      if (passwordModal?.querySelector('input[type="password"]')) {
        throw new Error('이 테스트는 응시 비밀번호가 필요합니다. 비밀번호를 입력해 직접 시작해 주세요.');
      }

      const confirmButton = firstVisibleInFrame(frame, [
        '#confirmModal.in .btn-ok',
        '.modal.in .btn-ok',
      ]);
      if (confirmButton) {
        lastAction = confirmButton.textContent.trim() || '응시 확인';
        confirmButton.click();
        await sleep(250);
        continue;
      }

      const nextButton = firstVisibleInFrame(frame, ['.btn-condition-next']);
      if (nextButton) {
        lastAction = nextButton.textContent.trim() || '조건 확인';
        nextButton.click();
        await sleep(150);
        continue;
      }

      const startButton = firstVisibleInFrame(frame, [
        '.btn-quiz-start',
        '.btn-start-renew-test',
      ]);
      if (startButton) {
        lastAction = startButton.textContent.trim() || '테스트 시작';
        startButton.click();
        await sleep(250);
        continue;
      }

      const retryTimeLayer = firstVisibleInFrame(frame, ['.retry-time-layer:not(.pass)']);
      if (retryTimeLayer) {
        throw new Error(
          retryTimeLayer.textContent.replace(/\s+/g, ' ').trim() ||
            '재응시 대기 시간이 남아 있습니다.',
        );
      }

      await sleep(100);
    }

    throw new Error(`테스트 문항 생성 시간이 초과되었습니다. 마지막 단계: ${lastAction}`);
  }

  function formDataFromDetachedForm(form) {
    const payload = new FormData();
    const controls = [...form.querySelectorAll('input, select, textarea')];
    for (const control of controls) {
      if (!control.name || control.disabled) continue;
      if (
        (control.type === 'checkbox' || control.type === 'radio') &&
        !control.checked
      ) {
        continue;
      }
      payload.append(control.name, control.value);
    }
    return payload;
  }

  async function prepareTest(context, options = {}) {
    const testUrl =
      options.testUrl ??
      `/ClassTest/${context.classId}/${context.setId}?p=1&ex=1`;
    const timeoutMs = Number(options.testTimeoutMs) || 20000;
    let frame = null;

    try {
      const currentForm = document.querySelector('#testForm');
      const currentQuestions = currentForm?.querySelectorAll(
        '[name="test_question[]"]',
      ).length;
      let testDocument;

      if (currentQuestions) {
        testDocument = document;
      } else {
        frame = await createTestFrame(testUrl, timeoutMs);
        testDocument = await generateTestQuestions(frame, timeoutMs);
      }

      const form = testDocument.querySelector('#testForm');
      const questionInputs = [...form.querySelectorAll('[name="test_question[]"]')];
      const userAnswerInputs = [...form.querySelectorAll('.user_answer')];
      const correctInputs = [...form.querySelectorAll('.gpt_correct')];
      const answers = answersForTest(testDocument, context.cards, options.answers);

      if (
        questionInputs.length !== userAnswerInputs.length ||
        questionInputs.length !== correctInputs.length ||
        questionInputs.length !== answers.length
      ) {
        throw new Error(
          `테스트 필드 수가 맞지 않습니다: 문항 ${questionInputs.length}, ` +
            `답안 ${userAnswerInputs.length}, 채점 ${correctInputs.length}, ` +
            `정답 ${answers.length}`,
        );
      }

      const flips = [...form.querySelectorAll('.flip-card')];
      const answerControls = answers.map((answer, index) => {
        if (answer.mode !== 'choice') return null;
        const choice = [...flips[index].querySelectorAll(
          'input[type="radio"], input[type="checkbox"]',
        )].find((input) => input.value === answer.value);
        if (!choice) {
          throw new Error(`${index + 1}번 정답 입력 요소를 다시 찾지 못했습니다.`);
        }
        choice.checked = true;
        return choice;
      });
      const submittedAnswers = answers.map((answer, index) =>
        answer.mode === 'choice'
          ? optionText(flips[index], answerControls[index])
          : answer.expected,
      );

      userAnswerInputs.forEach((input, index) => {
        input.value = submittedAnswers[index];
      });
      correctInputs.forEach((input) => {
        input.value = '1';
      });

      return {
        testUrl,
        testWindow: testDocument.defaultView,
        testDocument,
        form,
        questionCount: questionInputs.length,
        answers,
        answerControls,
        submittedAnswers,
        dispose: () => disposeTestFrame(frame),
      };
    } catch (error) {
      disposeTestFrame(frame);
      throw error;
    }
  }

  function responseDataFromXhr(xhr) {
    if (xhr?.responseJSON && typeof xhr.responseJSON === 'object') {
      return xhr.responseJSON;
    }
    try {
      return JSON.parse(xhr?.responseText ?? '');
    } catch {
      return null;
    }
  }

  function invokeJqueryHandler(testWindow, element, eventName, event) {
    const jquery = testWindow.jQuery;
    const handlers = jquery?._data?.(element, 'events')?.[eventName] ?? [];
    const handler = handlers.find((item) => typeof item.handler === 'function')?.handler;
    if (!handler) return false;
    handler.call(element, event);
    return true;
  }

  function rewriteSubmissionPayload(
    testWindow,
    originalPayload,
    submittedAnswers,
    answerControls,
  ) {
    if (!(originalPayload instanceof testWindow.FormData)) {
      throw new Error('사이트의 최종 제출 데이터 형식이 예상과 다릅니다.');
    }

    const payload = new testWindow.FormData();
    let answerIndex = 0;
    let correctIndex = 0;
    for (const [name, value] of originalPayload.entries()) {
      if (name === 'user_answer[]') {
        payload.append(name, submittedAnswers[answerIndex++] ?? '');
      } else if (name === 'gpt_correct[]') {
        payload.append(name, '1');
        correctIndex += 1;
      } else if (!/^input_radio_\d+$/u.test(name)) {
        payload.append(name, value);
      }
    }

    if (
      answerIndex !== submittedAnswers.length ||
      correctIndex !== submittedAnswers.length ||
      submittedAnswers.some((answer) => !String(answer).trim())
    ) {
      throw new Error(
        `빈 답안 제출을 차단했습니다: 답안 ${answerIndex}/${submittedAnswers.length}, ` +
          `채점 ${correctIndex}/${submittedAnswers.length}`,
      );
    }

    let objectiveCount = 0;
    answerControls.forEach((control, index) => {
      if (!control) return;
      if (!control.name || !control.value) {
        throw new Error(`${index + 1}번 객관식 답안 필드가 비어 있습니다.`);
      }
      payload.append(control.name, control.value);
      objectiveCount += 1;
    });

    const expectedObjectiveCount = answerControls.filter(Boolean).length;
    if (objectiveCount !== expectedObjectiveCount) {
      throw new Error(
        `객관식 답안 제출을 차단했습니다: ${objectiveCount}/${expectedObjectiveCount}`,
      );
    }
    return payload;
  }

  async function submitPreparedTest(prepared, timeoutMs = 20000) {
    const {
      testWindow,
      testDocument,
      form,
      questionCount,
      answers,
      answerControls,
      submittedAnswers,
    } = prepared;
    const jquery = testWindow?.jQuery;
    if (!jquery) {
      throw new Error('테스트 페이지의 제출 모듈을 찾지 못했습니다.');
    }

    const flips = [...form.querySelectorAll('.flip-card')];
    if (!flips.length || flips.length !== questionCount) {
      throw new Error('테스트 카드와 문항 수가 일치하지 않습니다.');
    }

    let failCompletion = () => {};
    const completion = new Promise((resolve, reject) => {
      let settled = false;
      const namespace = '.classcardAuto';
      const cleanup = () => {
        jquery(testDocument).off(`ajaxComplete${namespace}`, onComplete);
        jquery(testDocument).off(`ajaxError${namespace}`, onError);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        callback(value);
      };
      const onComplete = (_event, xhr, settings) => {
        if (!String(settings?.url ?? '').includes('/ClassTest/submittest')) return;
        const data = responseDataFromXhr(xhr);
        if (!data) {
          finish(
            reject,
            new Error('최종 제출 응답을 읽지 못했습니다. 로그인 상태를 확인해 주세요.'),
          );
          return;
        }
        if (data.result && data.result !== 'ok') {
          const message =
            data.msg === 'ontest'
              ? '사이트가 테스트를 아직 응시 중인 상태로 판단했습니다.'
              : data.msg || '테스트 제출이 거절되었습니다.';
          finish(reject, new Error(message));
          return;
        }
        finish(resolve, data);
      };
      const onError = (_event, xhr, settings) => {
        if (!String(settings?.url ?? '').includes('/ClassTest/submittest')) return;
        finish(
          reject,
          new Error(`최종 제출 요청이 실패했습니다: HTTP ${xhr?.status ?? '?'}`),
        );
      };
      const timer = setTimeout(
        () => finish(reject, new Error('사이트의 최종 제출 응답 시간이 초과되었습니다.')),
        timeoutMs,
      );
      failCompletion = (error) => finish(reject, error);
      jquery(testDocument).on(`ajaxComplete${namespace}`, onComplete);
      jquery(testDocument).on(`ajaxError${namespace}`, onError);
    });

    const originalAjax = jquery.ajax;
    const wrappedAjax = function (first, second) {
      const options =
        typeof first === 'string'
          ? { ...(second ?? {}), url: first }
          : { ...(first ?? {}) };
      if (String(options.url ?? '').includes('/ClassTest/submittest')) {
        try {
          options.data = rewriteSubmissionPayload(
            testWindow,
            options.data,
            submittedAnswers,
            answerControls,
          );
        } catch (error) {
          failCompletion(error);
          const deferred = jquery.Deferred();
          deferred.reject(null, 'error', error);
          return deferred.promise();
        }
      }
      return typeof first === 'string'
        ? originalAjax.call(this, first, options)
        : originalAjax.call(this, options);
    };
    jquery.ajax = wrappedAjax;

    if (testWindow.next_timer) {
      testWindow.clearTimeout(testWindow.next_timer);
      testWindow.next_timer = null;
    }
    testWindow.card_index = questionCount - 1;
    flips.forEach((flip, index) => {
      flip.classList.toggle('showing', index === questionCount - 1);
      flip.classList.toggle('flip', index === questionCount - 1);
    });

    const lastFlip = flips.at(-1);
    const lastAnswer = answers.at(-1);
    const sendButton = testDocument.querySelector('.btn-current-send-input');
    let triggered = false;

    // 사이트 자체 버튼의 click 이벤트가 정답 반영, 카드 인덱스 증가,
    // 최종 /ClassTest/submittest 호출을 한 번에 수행한다. jQuery 내부
    // 이벤트 저장소를 직접 호출하면 페이지 초기화 시점에 따라 핸들러가
    // 조회되지 않을 수 있으므로 일반 DOM click을 우선 사용한다.
    if (sendButton) {
      sendButton.click();
      triggered = true;
    }

    if (!triggered && lastAnswer.mode === 'choice') {
      const selected = [...lastFlip.querySelectorAll(
        'input[type="radio"], input[type="checkbox"]',
      )].find((input) => input.value === lastAnswer.value);
      if (selected) {
        selected.checked = true;
        triggered = invokeJqueryHandler(testWindow, selected, 'change', {
          originalEvent: { isTrusted: true },
          preventDefault() {},
          stopPropagation() {},
        });
      }
    }

    if (!triggered) {
      failCompletion(new Error('사이트의 마지막 문제 완료 동작을 찾지 못했습니다.'));
    }
    try {
      return await completion;
    } finally {
      if (jquery.ajax === wrappedAjax) jquery.ajax = originalAjax;
    }
  }

  async function submitTest(options = {}) {
    const context = getContext(options);
    const preview = makePreview(context);

    if (!requireSubmissionApproval(options)) {
      return {
        dryRun: true,
        type: 'test',
        preview,
        note: '실제 테스트 페이지를 생성하거나 제출하지 않은 미리보기입니다.',
      };
    }

    const prepared = await prepareTest(context, options);
    let data;
    try {
      data = await submitPreparedTest(
        prepared,
        Number(options.submitTimeoutMs) || 20000,
      );
    } finally {
      prepared.dispose();
    }

    return {
      dryRun: false,
      type: 'test',
      questionCount: prepared.questionCount,
      result: data.result ?? 'ok',
      message: data.msg ?? '',
      score: data.score?.score ?? null,
      scoreId: data.score?.test_sheet_score_idx ?? null,
      savedAt: data.score?.reg_date ?? null,
    };
  }

  async function runAll(options = {}) {
    const includeTest = options.includeTest !== false;
    const context = getContext(options);
    const preview = makePreview(context, options.activities);

    if (!requireSubmissionApproval(options)) {
      return {
        dryRun: true,
        type: 'all',
        includeTest,
        preview,
      };
    }

    const learning = await submitLearning({
      ...options,
      dryRun: false,
      confirmed: true,
    });
    const test = includeTest
      ? await submitTest({ ...options, dryRun: false, confirmed: true })
      : null;
    return { dryRun: false, type: 'all', learning, test };
  }

  function preview(options = {}) {
    const result = makePreview(getContext(options), options.activities);
    console.table(result.sections);
    console.log(`[${GLOBAL_NAME}] 미리보기`, result);
    return result;
  }

  function selectedActivities(panel) {
    return [...panel.querySelectorAll('[data-activity]:checked')].map(
      (input) => input.dataset.activity,
    );
  }

  function setPanelStatus(panel, message, kind = 'normal') {
    const status = panel.querySelector('[data-status]');
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function formatPreview(result) {
    const sections = result.sections
      .map((section) => `${section.section}구간 ${section.cardCount}장`)
      .join(', ');
    const activities = result.activities.map((item) => item.label).join('·');
    return [
      `세트 ${result.setId} / 클래스 ${result.classId}`,
      `카드 ${result.cardCount}장 (${sections})`,
      `학습: ${activities || '선택 없음'}`,
      `테스트 정답: ${result.testAnswerCount}개`,
    ].join('\n');
  }

  function installPanel() {
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
          width: min(360px, calc(100vw - 36px)); box-sizing: border-box;
          padding: 16px; border: 1px solid #cbd5e1; border-radius: 14px;
          background: #ffffff; color: #0f172a; box-shadow: 0 16px 50px #0f172a33;
          font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${PANEL_ID} * { box-sizing: border-box; }
        #${PANEL_ID} header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        #${PANEL_ID} h2 { margin:0; font-size:17px; }
        #${PANEL_ID} button { cursor:pointer; }
        #${PANEL_ID} .cc-close { border:0; background:transparent; color:#64748b; font-size:20px; }
        #${PANEL_ID} fieldset { margin:13px 0; padding:10px; border:1px solid #e2e8f0; border-radius:10px; }
        #${PANEL_ID} legend { padding:0 5px; color:#475569; }
        #${PANEL_ID} label { display:inline-flex; align-items:center; gap:5px; margin:3px 11px 3px 0; }
        #${PANEL_ID} .cc-actions { display:grid; grid-template-columns:1fr 1.4fr; gap:8px; }
        #${PANEL_ID} .cc-actions button { padding:10px 12px; border-radius:9px; border:1px solid #94a3b8; background:#f8fafc; }
        #${PANEL_ID} .cc-actions .cc-run { border-color:#2563eb; background:#2563eb; color:#fff; font-weight:700; }
        #${PANEL_ID} [data-status] { white-space:pre-wrap; max-height:170px; overflow:auto; margin:12px 0 0; padding:10px; border-radius:9px; background:#f1f5f9; color:#334155; }
        #${PANEL_ID} [data-status][data-kind="success"] { background:#ecfdf5; color:#166534; }
        #${PANEL_ID} [data-status][data-kind="error"] { background:#fef2f2; color:#991b1b; }
        #${PANEL_ID} .cc-note { margin:10px 0 0; color:#64748b; font-size:12px; }
      </style>
      <header>
        <h2>ClassCard Auto <small>v${VERSION}</small></h2>
        <button class="cc-close" type="button" title="닫기">×</button>
      </header>
      <fieldset>
        <legend>제출할 항목</legend>
        <label><input type="checkbox" data-activity="memorize" checked> 암기</label>
        <label><input type="checkbox" data-activity="recall" checked> 리콜</label>
        <label><input type="checkbox" data-activity="spell" checked> 스펠</label>
        <label><input type="checkbox" data-test checked> 테스트</label>
      </fieldset>
      <div class="cc-actions">
        <button type="button" data-preview>미리보기</button>
        <button type="button" class="cc-run" data-run>선택 항목 실행</button>
      </div>
      <pre data-status>미리보기를 눌러 현재 세트 정보를 확인하세요.</pre>
      <p class="cc-note">실행은 현재 로그인한 학생 계정에 실제 진도와 테스트 점수를 저장합니다.</p>
    `;
    document.body.append(panel);

    panel.querySelector('.cc-close').addEventListener('click', () => panel.remove());
    panel.querySelector('[data-preview]').addEventListener('click', () => {
      try {
        const activities = selectedActivities(panel);
        const result = preview({ activities });
        setPanelStatus(panel, formatPreview(result));
      } catch (error) {
        setPanelStatus(panel, error.message, 'error');
      }
    });
    panel.querySelector('[data-run]').addEventListener('click', async () => {
      const activities = selectedActivities(panel);
      const includeTest = panel.querySelector('[data-test]').checked;
      if (!activities.length && !includeTest) {
        setPanelStatus(panel, '실행할 항목을 하나 이상 선택해 주세요.', 'error');
        return;
      }

      let summary;
      try {
        summary = makePreview(getContext(), activities);
      } catch (error) {
        setPanelStatus(panel, error.message, 'error');
        return;
      }

      const description = [
        `세트 ${summary.setId}`,
        activities.length ? `${activities.map((name) => ACTIVITY_LABELS[name]).join('·')} 진도` : null,
        includeTest ? '테스트 자동 생성·제출' : null,
      ].filter(Boolean).join(' / ');

      if (!window.confirm(`${description}를 현재 학생 계정으로 실제 제출할까요?`)) {
        setPanelStatus(panel, '사용자가 제출을 취소했습니다.');
        return;
      }

      const runButton = panel.querySelector('[data-run]');
      runButton.disabled = true;
      setPanelStatus(panel, '제출 중입니다…');
      try {
        let result;
        if (activities.length && includeTest) {
          result = await runAll({
            activities,
            includeTest: true,
            dryRun: false,
            confirmed: true,
          });
        } else if (activities.length) {
          result = await submitLearning({
            activities,
            dryRun: false,
            confirmed: true,
          });
        } else {
          result = await submitTest({ dryRun: false, confirmed: true });
        }

        const learningCount = result.learning?.submissions?.length ?? result.submissions?.length ?? 0;
        const test = result.test ?? (result.type === 'test' ? result : null);
        const lines = ['제출이 완료되었습니다.'];
        if (learningCount) lines.push(`학습 진도 요청: ${learningCount}건 성공`);
        if (test) lines.push(`테스트: ${test.score ?? '?'}점 / ${test.questionCount}문항`);
        setPanelStatus(panel, lines.join('\n'), 'success');
        console.log(`[${GLOBAL_NAME}] 제출 결과`, result);
      } catch (error) {
        console.error(`[${GLOBAL_NAME}]`, error);
        setPanelStatus(panel, `오류: ${error.message}`, 'error');
      } finally {
        runButton.disabled = false;
      }
    });

    return panel;
  }

  const api = Object.freeze({
    version: VERSION,
    getContext,
    preview,
    submitLearning,
    submitTest,
    runAll,
    installPanel,
    removePanel: () => document.getElementById(PANEL_ID)?.remove(),
  });

  Object.defineProperty(window, GLOBAL_NAME, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });

  installPanel();
  console.log(
    `[${GLOBAL_NAME}] v${VERSION} 준비 완료. 기본 호출은 미리보기만 수행합니다.`,
  );
})();
