import { from, of, Subject } from 'rxjs';

import { rxStore } from './rx-store-service';
import { delay, filter, mergeAll, switchMap } from 'rxjs/operators';
import { IActionsData } from './interfaces/actions-data.interface';
import { IStateParams } from './interfaces/state-params.interface';


class StateDecorator<Y, T extends AnyClass> {
  private actionsData: IActionsData[];
  private sideEffects$: Subject<any[]> = new Subject();

  constructor(
    private params: IStateParams<Y>,
    private target: T
  ) {
    this.onInit();

    rxStore.addReducer({
      name: this.params.name,
      params: this.params,
      stateClass: this.target,
      createReducer: this.createReducer.bind(this)
    });
  }

  getTarget() {
    return this.target;
  }

  private onInit() {
    this.actionsData = this.getActionsData<T>(this.target);

    this.sideEffects$
    .pipe(
      delay(0),
      switchMap(actionsSideEffects => {
        return from(actionsSideEffects).pipe(mergeAll());
      }),
      filter((action: any) => action && action.constructor && action.constructor.type && typeof action.constructor.type === 'string')
    )
    .subscribe((action: AnyAction) => {
      rxStore.dispatch(action);
    })
  }

  private getActionsData<T extends AnyClass>(target: T): IActionsData[] {
    const metadataKeys: string[] = Reflect.getMetadataKeys(target.prototype);
    return metadataKeys
    .map((key: string) => {
      return Reflect.getMetadata(key, target.prototype);
    });
  }

  private createReducer(children?: any[]) {
    return (state = this.params.defaults, action: AnyAction) => {
      const nextState = this.executeActionsFn(state, action);
      if(children){

        const childrenStates = children.reduce((acc, children) => {
          return {
            ...acc,
            [children.name]: children.reducer(nextState[children.name], action),
          };
        }, {});

        return {
          ...nextState,
          ...childrenStates,
        }
      }

      return nextState;
    }
  }

  private next(nextState) {
    return (state) => {
      nextState.state = state;

      return of(nextState.state);
    }
  }

  private executeActionsFn(state, action) {
    let nextState: any = {};

    const filteredActionsFn = this.actionsData
    .filter(actionData => {
      return actionData.actionClass.type === action.type;
    })
    .map(actionData => {
      return actionData.actionFn;
    });

    const sideEffects = filteredActionsFn.map((fn: any) => {
      const sendState = nextState.state ? {...nextState.state} : state;
      return fn(this.next(nextState), sendState, action)
    });

    this.sideEffects$.next(sideEffects);

    return Object.keys(nextState).length ? nextState.state : state;
  }
}

export function State<Y>(params: IStateParams<Y>) {
  return function <T extends AnyClass>(constructor: T) {

    const decoratorClass = new StateDecorator<Y, T>(params, constructor);
    return decoratorClass.getTarget();
  };
}